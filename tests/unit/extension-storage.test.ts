import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearConnection,
  getOpenAiKey,
  getAllowlistedGroups,
  getConnection,
  saveAllowlistedGroup,
  setOpenAiKey,
  setConnection,
} from "../../extension/storage.js";

describe("extension storage", () => {
  let storageLocal: {
    get: (keys: string[]) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };

  beforeEach(() => {
    const store = new Map<string, unknown>();
    storageLocal = {
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

    vi.stubGlobal("chrome", {
      storage: {
        local: storageLocal,
      },
    });
  });

  test("stores and clears connection", async () => {
    await setConnection({
      token: "token-1",
      expiresAt: "2026-07-30T02:00:00.000Z",
      accountEmail: "tracy@example.com",
      workspaceName: "Apartment hunt",
    });
    expect(await getConnection()).toMatchObject({ accountEmail: "tracy@example.com" });
    await clearConnection();
    expect(await getConnection()).toBeNull();
  });

  test("dedupes allowlisted groups by id", async () => {
    await saveAllowlistedGroup({
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    });
    await saveAllowlistedGroup({
      id: "12345",
      name: "SF Housing Updated",
      url: "https://www.facebook.com/groups/12345",
    });
    expect(await getAllowlistedGroups()).toEqual([
      {
        id: "12345",
        name: "SF Housing Updated",
        url: "https://www.facebook.com/groups/12345",
      },
    ]);
  });

  test("keeps the stored connection when disconnect returns 403", async () => {
    vi.resetModules();

    let onMessageListener:
      | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean)
      | null = null;

    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id-1",
        onMessage: {
          addListener: vi.fn((listener) => {
            onMessageListener = listener;
          }),
        },
        onMessageExternal: {
          addListener: vi.fn(),
        },
      },
      storage: {
        local: storageLocal,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
      })),
    );

    await setConnection({
      token: "token-403",
      expiresAt: "2026-07-30T02:00:00.000Z",
      accountEmail: "tracy@example.com",
      workspaceName: "Apartment hunt",
    });

    await import("../../extension/background.js");

    const response = await new Promise((resolve) => {
      onMessageListener?.({ type: "apt-hunt-disconnect" }, {}, resolve);
    });

    expect(response).toEqual({ ok: false, error: "disconnect_failed" });
    expect(await getConnection()).toMatchObject({ token: "token-403" });
  });

  test("returns only display-safe connection fields to extension pages", async () => {
    vi.resetModules();

    let onMessageListener:
      | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean)
      | null = null;

    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension-id-1",
        onMessage: {
          addListener: vi.fn((listener) => {
            onMessageListener = listener;
          }),
        },
        onMessageExternal: {
          addListener: vi.fn(),
        },
      },
      storage: {
        local: storageLocal,
      },
    });

    await setConnection({
      token: "token-display-secret",
      expiresAt: "2026-07-30T02:00:00.000Z",
      accountEmail: "tracy@example.com",
      workspaceName: "Apartment hunt",
    });

    await import("../../extension/background.js");

    const response = await new Promise((resolve) => {
      onMessageListener?.({ type: "apt-hunt-get-connection" }, {}, resolve);
    });

    expect(response).toEqual({
      ok: true,
      connection: {
        expiresAt: "2026-07-30T02:00:00.000Z",
        accountEmail: "tracy@example.com",
        workspaceName: "Apartment hunt",
      },
    });
  });

  test("stores a trimmed OpenAI key and clears it when blank", async () => {
    await setOpenAiKey("  sk-test-key  ");
    expect(await getOpenAiKey()).toBe("sk-test-key");

    await setOpenAiKey("   ");
    expect(await getOpenAiKey()).toBe("");
  });
});
