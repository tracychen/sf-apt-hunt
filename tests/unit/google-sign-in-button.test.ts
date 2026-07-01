// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { authClient } from "@/lib/auth-client";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: vi.fn(async () => ({
        data: { redirect: true, url: "https://accounts.google.com/" },
        error: null,
      })),
    },
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("GoogleSignInButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("starts Better Auth Google social sign-in", async () => {
    const { button, unmount } = renderButton(
      createElement(
        GoogleSignInButton,
        { callbackURL: "/extension/connect?extensionId=abc" },
        "Connect with Google",
      ),
    );

    await click(button);

    expect(authClient.signIn.social as Mock).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/extension/connect?extensionId=abc",
    });

    unmount();
  });

  test("omits callbackURL when none is provided", async () => {
    const { button, unmount } = renderButton(createElement(GoogleSignInButton));

    await click(button);

    expect(authClient.signIn.social as Mock).toHaveBeenCalledWith({
      provider: "google",
    });

    unmount();
  });
});

function renderButton(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  const button = container.querySelector("button");
  if (!button) {
    throw new Error("Expected button to render");
  }

  return {
    button,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}
