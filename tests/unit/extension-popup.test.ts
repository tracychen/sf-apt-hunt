import { afterEach, describe, expect, test, vi } from "vitest";
import { JSDOM } from "jsdom";

type StoredGroup = {
  id: string;
  name: string;
  url: string;
};

describe("extension popup allowlist manager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("adds the active Facebook group page to the allowlist", async () => {
    const { document, readStoredAllowlist, window } = await loadPopup({
      activeTab: {
        title: "SF Housing | Facebook",
        url: "https://www.facebook.com/groups/12345",
      },
    });

    const addCurrentGroup = document.querySelector<HTMLButtonElement>("#add-current-group");

    expect(addCurrentGroup).not.toBeNull();

    addCurrentGroup?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    expect(readStoredAllowlist()).toEqual([
      {
        id: "12345",
        name: "SF Housing",
        url: "https://www.facebook.com/groups/12345",
      },
    ]);
  });

  test("manually adds and edits a group by URL and display name", async () => {
    const { document, readStoredAllowlist, window } = await loadPopup();
    const form = document.querySelector<HTMLFormElement>("#allowlist-form");
    const urlInput = document.querySelector<HTMLInputElement>("#allowlist-url");
    const nameInput = document.querySelector<HTMLInputElement>("#allowlist-name");

    expect(form).not.toBeNull();
    expect(urlInput).not.toBeNull();
    expect(nameInput).not.toBeNull();

    urlInput!.value = "https://www.facebook.com/groups/999";
    nameInput!.value = "Sunset Rentals";
    form?.dispatchEvent(new window.SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await flush();

    urlInput!.value = "https://www.facebook.com/groups/999";
    nameInput!.value = "Sunset Rentals Updated";
    form?.dispatchEvent(new window.SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(readStoredAllowlist()).toEqual([
      {
        id: "999",
        name: "Sunset Rentals Updated",
        url: "https://www.facebook.com/groups/999",
      },
    ]);
  });

  test("removes an allowlisted group", async () => {
    const { document, readStoredAllowlist, window } = await loadPopup({
      groups: [
        {
          id: "12345",
          name: "SF Housing",
          url: "https://www.facebook.com/groups/12345",
        },
      ],
    });

    const removeButton = document.querySelector<HTMLButtonElement>(
      '[data-allowlist-remove-id="12345"]',
    );

    expect(removeButton).not.toBeNull();

    removeButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    expect(readStoredAllowlist()).toEqual([]);
  });
});

async function loadPopup({
  activeTab,
  groups = [],
}: {
  activeTab?: { title?: string; url: string };
  groups?: StoredGroup[];
} = {}) {
  vi.resetModules();

  const dom = new JSDOM(
    `<body>
      <main>
        <section id="connection"></section>
        <section id="openai-key"></section>
        <section id="allowlist"></section>
      </main>
    </body>`,
    {
      url: "chrome-extension://extension-id/popup.html",
    },
  );
  const store = new Map<string, unknown>([
    ["aptHuntAllowlistedGroups", structuredClone(groups)],
  ]);
  const storageLocal = {
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, store.get(key)])),
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, value);
      }
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };

  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension-id",
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === "apt-hunt-get-connection") {
          return { ok: true, connection: null };
        }

        return { ok: false };
      }),
    },
    storage: {
      local: storageLocal,
    },
    tabs: {
      create: vi.fn(),
      query: vi.fn(async () => (activeTab ? [activeTab] : [])),
    },
  });

  await import("../../extension/popup.js");
  await flush();

  return {
    document: dom.window.document,
    readStoredAllowlist: () =>
      structuredClone((store.get("aptHuntAllowlistedGroups") ?? []) as StoredGroup[]),
    window: dom.window,
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
