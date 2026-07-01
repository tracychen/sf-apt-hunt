// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";

import { ExtensionDiscoveryCard } from "@/components/apartment-map/extension-discovery-card";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ExtensionDiscoveryCard", () => {
  test("shows local setup instructions for signed-in workspaces", () => {
    const { container, unmount } = renderCard("workspace");

    expect(container.textContent).toContain("Facebook saver extension");
    expect(container.textContent).toContain("Save reviewed Facebook housing posts into this workspace.");
    expect(container.textContent).toContain("Setup extension");
    expect(container.textContent).toContain("Load unpacked");
    expect(container.textContent).toContain("EXTENSION_ALLOWED_IDS");
    expect(container.querySelector("button")).toBeNull();

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

function renderCard(ownershipMode: "local" | "workspace") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(ExtensionDiscoveryCard, { ownershipMode }));
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
