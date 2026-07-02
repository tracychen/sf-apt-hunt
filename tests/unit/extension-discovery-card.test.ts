// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";

import { ExtensionDiscoveryCard } from "@/components/apartment-map/extension-discovery-card";
import { getValidChromeExtensionUrl } from "@/lib/extension/chrome-store-url";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ExtensionDiscoveryCard", () => {
  test("validates Chrome Web Store extension URLs", () => {
    expect(
      getValidChromeExtensionUrl(
        "https://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe("https://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      getValidChromeExtensionUrl(
        "https://chrome.google.com/webstore/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe("https://chrome.google.com/webstore/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      getValidChromeExtensionUrl("https://chromewebstore.google.com/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBe("https://chromewebstore.google.com/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      getValidChromeExtensionUrl("https://chrome.google.com/webstore/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBe("https://chrome.google.com/webstore/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      getValidChromeExtensionUrl(
        "http://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBeNull();
    expect(
      getValidChromeExtensionUrl("https://example.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBeNull();
    expect(getValidChromeExtensionUrl("https://chromewebstore.google.com/category/extensions")).toBeNull();
  });

  test("rejects malformed modern Chrome Web Store detail URLs", () => {
    expect(getValidChromeExtensionUrl("https://chromewebstore.google.com/detail/")).toBeNull();
    expect(getValidChromeExtensionUrl("https://chromewebstore.google.com/detail/not-an-extension")).toBeNull();
    expect(getValidChromeExtensionUrl("https://chromewebstore.google.com/detail/apt-hunt/not-an-extension")).toBeNull();
    expect(
      getValidChromeExtensionUrl("https://chromewebstore.google.com/detail/apt-hunt/abcdefghijklmnopabcdefghijklmnox"),
    ).toBeNull();
  });

  test("rejects malformed legacy Chrome Web Store detail URLs", () => {
    expect(getValidChromeExtensionUrl("https://chrome.google.com/webstore/detail/")).toBeNull();
    expect(getValidChromeExtensionUrl("https://chrome.google.com/webstore/detail/not-an-extension")).toBeNull();
    expect(getValidChromeExtensionUrl("https://chrome.google.com/webstore/detail/apt-hunt/not-an-extension")).toBeNull();
    expect(
      getValidChromeExtensionUrl("https://chrome.google.com/webstore/detail/apt-hunt/abcdefghijklmnopabcdefghijklmnox"),
    ).toBeNull();
  });

  test("shows unavailable install state and collapsed developer setup for workspace mode without a URL", () => {
    const { container, unmount } = renderCard("workspace");

    expect(container.textContent).toContain("Facebook saver extension");
    expect(container.textContent).toContain("Save reviewed Facebook housing posts into this workspace.");
    expect(container.textContent).toContain("Chrome Web Store install is not ready for public install yet.");
    expect(container.textContent).toContain("After installing, open the extension popup and choose Connect Apt Hunt.");
    expect(container.textContent).toContain("Developer setup");
    expect(container.textContent).toContain("Load unpacked");
    expect(container.textContent).toContain("EXTENSION_ALLOWED_IDS");
    expect(container.querySelector("details")?.open).toBe(false);
    expect(anchorByText(container, "Install Chrome Extension")).toBeNull();
    expect(container.querySelector("button")).toBeNull();

    unmount();
  });

  test("renders the Chrome Web Store install link for workspace mode with a valid URL", () => {
    const validUrl = "https://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { container, unmount } = renderCard("workspace", validUrl);

    const installLink = anchorByText(container, "Install Chrome Extension");

    expect(installLink).not.toBeNull();
    expect(installLink?.href).toBe(validUrl);
    expect(container.textContent).toContain("After installing, open the extension popup and choose Connect Apt Hunt.");
    expect(container.textContent).not.toContain("Chrome Web Store install is not ready for public install yet.");

    unmount();
  });

  test("does not render the Chrome Web Store install link for workspace mode with an invalid URL", () => {
    const { container, unmount } = renderCard("workspace", "https://example.com/not-the-store");

    expect(anchorByText(container, "Install Chrome Extension")).toBeNull();
    expect(container.textContent).toContain("Chrome Web Store install is not ready for public install yet.");

    unmount();
  });

  test("points local-first users to sign in before using extension sync", () => {
    const { container, unmount } = renderCard("local");

    expect(container.textContent).toContain("Facebook saver extension");
    expect(container.textContent).toContain("Sign in to sync Facebook saves across devices.");
    expect(container.textContent).toContain("Sign in to use extension");
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.textContent).not.toContain("EXTENSION_ALLOWED_IDS");

    unmount();
  });
});

function renderCard(ownershipMode: "local" | "workspace", chromeExtensionUrl?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(ExtensionDiscoveryCard, { ownershipMode, chromeExtensionUrl }));
  });

  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function anchorByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("a")).find((anchor) => anchor.textContent === text) ?? null;
}
