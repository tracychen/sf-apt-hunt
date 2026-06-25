// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { OnboardingPanel } from "@/components/apartment-map/onboarding-panel";
import type { OnboardingController } from "@/components/apartment-map/use-onboarding-controller";
import { useOnboardingController } from "@/components/apartment-map/use-onboarding-controller";
import type { OnboardingProgress } from "@/lib/domain/types";
import { createDefaultOnboardingProgress } from "@/lib/onboarding/progress";
import { onboardingStepIds } from "@/lib/onboarding/steps";
import { onboardingProgressStorageKey } from "@/lib/storage/onboarding-storage";

const firstNow = "2026-06-24T12:00:00.000Z";
const secondNow = "2026-06-24T12:05:00.000Z";

describe("useOnboardingController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test("does not regress completed steps when workspace completeSteps responses arrive out of order", async () => {
    const requests: Array<{
      body: unknown;
      response: Deferred<Response>;
    }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const response = createDeferred<Response>();
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : null,
          response,
        });
        return response.promise;
      }),
    );

    const initialProgress = createDefaultOnboardingProgress(firstNow);
    const { getController, unmount } = renderController(initialProgress);

    await act(async () => {
      await nextTick();
    });

    await act(async () => {
      getController().completeSteps(["set_ai_key"]);
    });
    await act(async () => {
      getController().completeSteps(["review_listing"]);
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.body)).toEqual([
      { operation: { type: "completeSteps", stepIds: ["set_ai_key"] } },
      { operation: { type: "completeSteps", stepIds: ["review_listing"] } },
    ]);

    await act(async () => {
      requests[1]?.response.resolve(
        jsonResponse({
          ok: true,
          progress: progressWithCompletedSteps({
            set_ai_key: firstNow,
            review_listing: secondNow,
          }),
        }),
      );
      await Promise.resolve();
    });

    expect(getController().progress.completedSteps).toEqual({
      set_ai_key: firstNow,
      review_listing: secondNow,
    });

    await act(async () => {
      requests[0]?.response.resolve(
        jsonResponse({
          ok: true,
          progress: progressWithCompletedSteps({
            set_ai_key: firstNow,
          }),
        }),
      );
      await Promise.resolve();
    });

    expect(getController().progress.completedSteps).toEqual({
      set_ai_key: firstNow,
      review_listing: secondNow,
    });

    unmount();
  });

  test("does not regress completed steps when a workspace panel response arrives late", async () => {
    const requests: Array<{
      body: unknown;
      response: Deferred<Response>;
    }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const response = createDeferred<Response>();
        requests.push({
          body: init?.body ? JSON.parse(String(init.body)) : null,
          response,
        });
        return response.promise;
      }),
    );

    const initialProgress = createDefaultOnboardingProgress(firstNow);
    const { getController, unmount } = renderController(initialProgress);

    await act(async () => {
      getController().setPanelState({ lastHighlightedStepId: "ask_for_anchors" });
    });
    await act(async () => {
      getController().completeSteps(["edit_anchor_meaning"]);
    });

    expect(getController().progress.completedSteps).toEqual({
      edit_anchor_meaning: expect.any(String),
    });

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.body)).toEqual([
      {
        operation: {
          type: "setPanelState",
          lastHighlightedStepId: "ask_for_anchors",
        },
      },
      { operation: { type: "completeSteps", stepIds: ["edit_anchor_meaning"] } },
    ]);

    await act(async () => {
      requests[1]?.response.resolve(
        jsonResponse({
          ok: true,
          progress: progressWithCompletedSteps({
            edit_anchor_meaning: secondNow,
          }),
        }),
      );
      await Promise.resolve();
    });

    expect(getController().progress.completedSteps).toEqual({
      edit_anchor_meaning: secondNow,
    });

    await act(async () => {
      requests[0]?.response.resolve(
        jsonResponse({
          ok: true,
          progress: {
            ...createDefaultOnboardingProgress(firstNow),
            lastHighlightedStepId: "ask_for_anchors",
          },
        }),
      );
      await Promise.resolve();
    });

    expect(getController().progress.completedSteps).toEqual({
      edit_anchor_meaning: secondNow,
    });
    expect(getController().progress.lastHighlightedStepId).toBe("ask_for_anchors");

    unmount();
  });

  test("loads local progress after the first render", async () => {
    const storedProgress = progressWithCompletedSteps({
      set_ai_key: firstNow,
    });
    const { getController, unmount } = renderController(storedProgress, { mode: "local" });

    expect(getController().progress.completedSteps).toEqual({});

    await act(async () => {
      await nextTick();
    });

    expect(getController().progress.completedSteps).toEqual({
      set_ai_key: firstNow,
    });

    unmount();
  });

  test("hydrates updated workspace progress after client state loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, progress: createDefaultOnboardingProgress(firstNow) }))),
    );

    const { getController, rerender, unmount } = renderController(
      createDefaultOnboardingProgress(firstNow),
    );

    expect(getController().progress.completedSteps).toEqual({});

    await act(async () => {
      rerender(
        progressWithCompletedSteps({
          set_ai_key: secondNow,
        }),
      );
    });

    await act(async () => {
      await nextTick();
    });

    expect(getController().progress.completedSteps).toEqual({
      set_ai_key: secondNow,
    });

    unmount();
  });

  test("collapses once when completing the final onboarding step", async () => {
    const initialProgress = progressWithCompletedSteps({
      set_ai_key: firstNow,
      ask_for_anchors: firstNow,
      apply_map_suggestion: firstNow,
      edit_anchor_meaning: firstNow,
      ask_for_listings: firstNow,
    });
    const { getController, unmount } = renderController(initialProgress, { mode: "local" });

    await act(async () => {
      await nextTick();
    });

    await act(async () => {
      getController().completeSteps(["review_listing"]);
    });

    expect(getController().progress.expanded).toBe(false);

    await act(async () => {
      getController().setPanelState({ expanded: true });
    });

    expect(getController().progress.expanded).toBe(true);

    await act(async () => {
      getController().completeSteps([...onboardingStepIds]);
    });

    expect(getController().progress.expanded).toBe(true);

    unmount();
  });
});

describe("OnboardingPanel", () => {
  test("labels only the first incomplete step as next", () => {
    const progress = progressWithCompletedSteps({
      set_ai_key: firstNow,
    });
    const { container, unmount } = renderPanel(progress);

    expect(container.textContent).toContain("Complete: Add your OpenAI key");
    expect(container.textContent).toContain("Next: Ask chat to add pins or corridors");
    expect(container.textContent).toContain("Pending: Review a suggested map change");

    unmount();
  });
});

function renderController(
  initialProgress: OnboardingProgress,
  options: { mode?: "local" | "workspace" } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let controller: OnboardingController | null = null;
  const mode = options.mode ?? "workspace";

  if (mode === "local") {
    window.localStorage.setItem(onboardingProgressStorageKey, JSON.stringify(initialProgress));
  }

  function Harness({ initialProgress }: { initialProgress: OnboardingProgress }) {
    controller = useOnboardingController({
      apiKey: null,
      listingLeads: [],
      mode:
        mode === "workspace"
          ? { kind: "workspace", initialProgress }
          : { kind: "local" },
      planningThreadCache: null,
    });
    return null;
  }

  act(() => {
    root.render(createElement(Harness, { initialProgress }));
  });

  return {
    getController() {
      if (!controller) {
        throw new Error("Controller was not rendered.");
      }
      return controller;
    },
    rerender(nextProgress: OnboardingProgress) {
      root.render(createElement(Harness, { initialProgress: nextProgress }));
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function renderPanel(progress: OnboardingProgress) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      createElement(OnboardingPanel, {
        completedCount: Object.keys(progress.completedSteps).length,
        progress,
        highlightMessage: null,
        persistenceError: null,
        onDismiss: () => undefined,
        onReset: () => undefined,
        onReview: () => undefined,
        onShowStep: () => undefined,
      }),
    );
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

function progressWithCompletedSteps(
  completedSteps: OnboardingProgress["completedSteps"],
): OnboardingProgress {
  return {
    ...createDefaultOnboardingProgress(secondNow),
    completedSteps,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    json: async () => body,
  } as Response;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function nextTick() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
