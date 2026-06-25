import { beforeEach, describe, expect, test, vi } from "vitest";

import type { OnboardingOperation, OnboardingProgress } from "@/lib/domain/types";

const sessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));
const workspaceMocks = vi.hoisted(() => ({
  updateWorkspaceOnboarding: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", () => {
  class MockUnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
    }
  }

  return {
    UnauthorizedError: MockUnauthorizedError,
    requireCurrentUserId: async () => {
      if (!sessionMock.userId) {
        throw new MockUnauthorizedError();
      }

      return sessionMock.userId;
    },
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async (userId: string) => ({
    workspace: {
      id: "workspace-1",
      userId,
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      onboardingProgress: createProgress(),
      createdAt: new Date("2026-06-24T12:00:00.000Z"),
      updatedAt: new Date("2026-06-24T12:00:00.000Z"),
    },
  }),
}));

vi.mock("@/lib/server/workspace-onboarding", () => ({
  updateWorkspaceOnboarding: workspaceMocks.updateWorkspaceOnboarding,
}));

import { PUT } from "@/app/api/workspace/onboarding/route";

describe("PUT /api/workspace/onboarding", () => {
  beforeEach(() => {
    sessionMock.userId = null;
    workspaceMocks.updateWorkspaceOnboarding.mockReset();
    workspaceMocks.updateWorkspaceOnboarding.mockResolvedValue(
      createProgress({
        completedSteps: {
          set_ai_key: "2026-06-24T12:05:00.000Z",
        },
      }),
    );
  });

  test("rejects signed-out users", async () => {
    const response = await PUT(createRequest({ type: "completeSteps", stepIds: ["set_ai_key"] }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(workspaceMocks.updateWorkspaceOnboarding).not.toHaveBeenCalled();
  });

  test("rejects cross-site writes", async () => {
    sessionMock.userId = "user-1";

    const response = await PUT(
      createRequest(
        { type: "completeSteps", stepIds: ["set_ai_key"] },
        {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "forbidden_origin" });
    expect(workspaceMocks.updateWorkspaceOnboarding).not.toHaveBeenCalled();
  });

  test("rejects invalid bodies", async () => {
    sessionMock.userId = "user-1";

    const response = await PUT(createRawRequest({ operation: { type: "completeSteps", stepIds: [] } }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
  });

  test("returns 413 for oversized bodies", async () => {
    sessionMock.userId = "user-1";

    const response = await PUT(
      new Request("http://localhost/api/workspace/onboarding", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ operation: { type: "reset" }, padding: "x".repeat(20_000) }),
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "request_too_large" });
  });

  test("updates the current user's default workspace", async () => {
    sessionMock.userId = "user-1";
    const operation: OnboardingOperation = { type: "completeSteps", stepIds: ["set_ai_key"] };

    const response = await PUT(createRequest(operation));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      progress: createProgress({
        completedSteps: {
          set_ai_key: "2026-06-24T12:05:00.000Z",
        },
      }),
    });
    expect(workspaceMocks.updateWorkspaceOnboarding).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      operation,
    });
  });

  test("returns safe 500 when persistence fails", async () => {
    sessionMock.userId = "user-1";
    workspaceMocks.updateWorkspaceOnboarding.mockRejectedValueOnce(new Error("db down"));

    const response = await PUT(createRequest({ type: "reset" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "onboarding_update_failed" });
  });
});

function createRequest(operation: OnboardingOperation, headers: Record<string, string> = {}) {
  return createRawRequest({ operation }, headers);
}

function createRawRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/workspace/onboarding", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
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
