import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/workspace/reset/route";
import { seedMapState } from "@/lib/map/seed-data";

const routeMocks = vi.hoisted(() => ({
  resetWorkspace: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", async () => {
  class MockUnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
    }
  }

  return {
    UnauthorizedError: MockUnauthorizedError,
    requireCurrentUserId: async () => "user-1",
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async () => ({
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
    mapSnapshot: {
      id: "snapshot-1",
      workspaceId: "workspace-1",
      revision: "map-1",
      mapState: seedMapState,
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
  }),
}));

vi.mock("@/lib/server/workspace-state", () => ({
  resetWorkspace: routeMocks.resetWorkspace,
}));

describe("POST /api/workspace/reset", () => {
  beforeEach(() => {
    routeMocks.resetWorkspace.mockReset();
    routeMocks.resetWorkspace.mockResolvedValue({
      ok: true,
      workspace: {
        id: "workspace-1",
        userId: "user-1",
        name: "Apartment hunt",
        listingLedgerRevision: "ledger-2",
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-2",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      listingLedgerRevision: "ledger-2",
    });
  });

  test("requires reset confirmation", async () => {
    const response = await POST(
      createPostRequest({
        expectedMapRevision: "map-1",
        expectedListingLedgerRevision: "ledger-1",
        confirmation: "delete",
      }),
    );

    expect(response.status).toBe(400);
  });

  test("returns fresh revisions after reset", async () => {
    const response = await POST(
      createPostRequest({
        expectedMapRevision: "map-1",
        expectedListingLedgerRevision: "ledger-1",
        confirmation: "reset",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mapSnapshot.revision).toBe("map-2");
    expect(body.listingLedgerRevision).toBe("ledger-2");
  });

  test("returns 409 for stale workspace revisions", async () => {
    routeMocks.resetWorkspace.mockResolvedValueOnce({
      ok: false,
      error: "stale_workspace_revision",
      currentMapRevision: "map-2",
      currentListingLedgerRevision: "ledger-2",
    });

    const response = await POST(
      createPostRequest({
        expectedMapRevision: "map-1",
        expectedListingLedgerRevision: "ledger-1",
        confirmation: "reset",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "stale_workspace_revision",
      currentMapRevision: "map-2",
      currentListingLedgerRevision: "ledger-2",
    });
  });
});

function createPostRequest(body: unknown) {
  return new Request("http://localhost/api/workspace/reset", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}
