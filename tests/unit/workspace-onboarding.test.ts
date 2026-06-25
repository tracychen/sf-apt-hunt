import { beforeEach, describe, expect, test, vi } from "vitest";

import { workspaces } from "@/lib/db/schema";
import type { OnboardingProgress } from "@/lib/domain/types";

type WorkspaceOnboardingDbState = {
  workspace: {
    id: string;
    onboardingProgress: OnboardingProgress | null;
    updatedAt: Date;
  };
};

type WorkspaceOnboardingDbHooks = {
  beforeUpdateOnce: null | (() => void);
};

type WorkspaceOnboardingDbMock = {
  state: WorkspaceOnboardingDbState;
  hooks: WorkspaceOnboardingDbHooks;
  transaction: <T>(callback: (tx: ReturnType<typeof createTx>) => Promise<T>) => Promise<T>;
};

const dbMock = vi.hoisted(() => ({
  current: null as WorkspaceOnboardingDbMock | null,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => {
    if (!dbMock.current) {
      throw new Error("Database mock not initialized");
    }

    return dbMock.current;
  },
}));

import { updateWorkspaceOnboarding } from "@/lib/server/workspace-onboarding";

describe("workspace onboarding persistence", () => {
  beforeEach(() => {
    dbMock.current = createDbMock();
  });

  test("completeSteps merges with existing DB progress", async () => {
    getDb().state.workspace.onboardingProgress = createProgress({
      completedSteps: {
        set_ai_key: "2026-06-24T12:00:00.000Z",
      },
    });

    const result = await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "completeSteps", stepIds: ["ask_for_listings"] },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(result.completedSteps).toEqual({
      set_ai_key: "2026-06-24T12:00:00.000Z",
      ask_for_listings: "2026-06-24T12:05:00.000Z",
    });
    expect(getDb().state.workspace.onboardingProgress).toEqual(result);
  });

  test("concurrent completeSteps requests both persist", async () => {
    getDb().hooks.beforeUpdateOnce = () => {
      getDb().state.workspace.onboardingProgress = createProgress({
        completedSteps: {
          set_ai_key: "2026-06-24T12:01:00.000Z",
        },
      });
    };

    await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "completeSteps", stepIds: ["ask_for_listings"] },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(getDb().state.workspace.onboardingProgress?.completedSteps).toEqual({
      set_ai_key: "2026-06-24T12:01:00.000Z",
      ask_for_listings: "2026-06-24T12:05:00.000Z",
    });
  });

  test("setPanelState does not alter completed steps", async () => {
    getDb().state.workspace.onboardingProgress = createProgress({
      completedSteps: {
        set_ai_key: "2026-06-24T12:00:00.000Z",
      },
    });

    const result = await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "setPanelState", dismissed: true, expanded: false },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(result.completedSteps).toEqual({ set_ai_key: "2026-06-24T12:00:00.000Z" });
    expect(result.dismissed).toBe(true);
    expect(result.expanded).toBe(false);
  });

  test("reset clears completed steps", async () => {
    getDb().state.workspace.onboardingProgress = createProgress({
      completedSteps: {
        set_ai_key: "2026-06-24T12:00:00.000Z",
      },
    });

    const result = await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "reset" },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(result).toEqual(createProgress({ updatedAt: "2026-06-24T12:05:00.000Z" }));
  });
});

function getDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

function createProgress(overrides: Partial<OnboardingProgress> = {}): OnboardingProgress {
  return {
    version: 1,
    dismissed: false,
    expanded: true,
    completedSteps: {},
    lastHighlightedStepId: null,
    updatedAt: "2026-06-24T12:00:00.000Z",
    ...overrides,
  };
}

function createDbMock(): WorkspaceOnboardingDbMock {
  const state = {
    workspace: {
      id: "workspace-1",
      onboardingProgress: null as OnboardingProgress | null,
      updatedAt: new Date("2026-06-24T12:00:00.000Z"),
    },
  };
  const hooks = {
    beforeUpdateOnce: null as null | (() => void),
  };

  return {
    state,
    hooks,
    transaction: async <T>(callback: (tx: ReturnType<typeof createTx>) => Promise<T>) =>
      callback(createTx(state, hooks)),
  };
}

function createTx(
  state: WorkspaceOnboardingDbState,
  hooks: WorkspaceOnboardingDbHooks,
) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => ({
          for: async (lock: "update") => {
            expect(table).toBe(workspaces);
            expect(lock).toBe("update");
            expect(condition).toMatchObject({ type: "eq" });
            return [state.workspace];
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Partial<typeof state.workspace>) => ({
        where: () => ({
          returning: async () => {
            expect(table).toBe(workspaces);
            hooks.beforeUpdateOnce?.();
            hooks.beforeUpdateOnce = null;
            const currentCompleted = state.workspace.onboardingProgress?.completedSteps ?? {};
            const nextCompleted = values.onboardingProgress?.completedSteps ?? {};
            const shouldMergeCompletedSteps = Object.keys(nextCompleted).length > 0;
            state.workspace = {
              ...state.workspace,
              ...values,
              onboardingProgress: values.onboardingProgress
                ? {
                    ...values.onboardingProgress,
                    completedSteps: shouldMergeCompletedSteps
                      ? {
                          ...currentCompleted,
                          ...nextCompleted,
                        }
                      : nextCompleted,
                  }
                : values.onboardingProgress ?? null,
            };
            return [state.workspace];
          },
        }),
      }),
    }),
  };
}
