import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET as CLIENT_STATE_GET } from "@/app/api/workspace/client-state/route";
import { DELETE, GET } from "@/app/api/workspace/route";
import type { ListingLead } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";

const sessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));
const listingRouteMocks = vi.hoisted(() => ({
  listWorkspaceListingLeads: vi.fn(),
}));
const planningRouteMocks = vi.hoisted(() => ({
  listWorkspacePlanningThreadCache: vi.fn(),
}));
const workspaceRouteMocks = vi.hoisted(() => ({
  deleteDefaultWorkspaceForUser: vi.fn(),
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
      listingLedgerRevision: "ledger-123",
      createdAt: new Date("2026-06-23T12:00:00.000Z"),
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    },
    mapSnapshot: {
      id: "snapshot-1",
      workspaceId: "workspace-1",
      revision: "map-123",
      mapState: seedMapState,
      createdAt: new Date("2026-06-23T12:00:00.000Z"),
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    },
  }),
  deleteDefaultWorkspaceForUser: workspaceRouteMocks.deleteDefaultWorkspaceForUser,
  serializeWorkspaceResponse: (input: {
    workspace: {
      id: string;
      userId: string;
      name: string;
      listingLedgerRevision: string;
      createdAt: Date;
      updatedAt: Date;
    };
    mapSnapshot: {
      id: string;
      workspaceId: string;
      revision: string;
      mapState: typeof seedMapState;
      createdAt: Date;
      updatedAt: Date;
    };
  }) => ({
    workspace: {
      ...input.workspace,
      createdAt: input.workspace.createdAt.toISOString(),
      updatedAt: input.workspace.updatedAt.toISOString(),
    },
    mapSnapshot: {
      ...input.mapSnapshot,
      createdAt: input.mapSnapshot.createdAt.toISOString(),
      updatedAt: input.mapSnapshot.updatedAt.toISOString(),
    },
    listingLedgerRevision: input.workspace.listingLedgerRevision,
  }),
  serializeWorkspaceRecord: (workspace: {
    id: string;
    userId: string;
    name: string;
    listingLedgerRevision: string;
    createdAt: Date;
    updatedAt: Date;
  }) => ({
    ...workspace,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  }),
  serializeWorkspaceMapSnapshot: (mapSnapshot: {
    id: string;
    workspaceId: string;
    revision: string;
    mapState: typeof seedMapState;
    createdAt: Date;
    updatedAt: Date;
  }) => ({
    ...mapSnapshot,
    createdAt: mapSnapshot.createdAt.toISOString(),
    updatedAt: mapSnapshot.updatedAt.toISOString(),
  }),
}));

vi.mock("@/lib/server/listing-leads-db", () => ({
  listWorkspaceListingLeads: listingRouteMocks.listWorkspaceListingLeads,
}));

vi.mock("@/lib/server/planning/store-db", () => ({
  listWorkspacePlanningThreadCache: planningRouteMocks.listWorkspacePlanningThreadCache,
}));

describe("GET /api/workspace", () => {
  beforeEach(() => {
    sessionMock.userId = null;
    listingRouteMocks.listWorkspaceListingLeads.mockReset();
    planningRouteMocks.listWorkspacePlanningThreadCache.mockReset();
    workspaceRouteMocks.deleteDefaultWorkspaceForUser.mockReset();
    listingRouteMocks.listWorkspaceListingLeads.mockResolvedValue({
      leads: [createLead()],
      listingLedgerRevision: "ledger-123",
    });
    planningRouteMocks.listWorkspacePlanningThreadCache.mockResolvedValue(createPlanningThreadCache());
    workspaceRouteMocks.deleteDefaultWorkspaceForUser.mockResolvedValue({ deleted: true });
  });

  test("rejects signed-out users", async () => {
    const response = await GET(new Request("http://localhost/api/workspace"));

    expect(response.status).toBe(401);
  });

  test("creates and returns a default workspace for signed-in users", async () => {
    sessionMock.userId = "user-1";

    const response = await GET(new Request("http://localhost/api/workspace"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workspace.userId).toBe("user-1");
    expect(body.mapSnapshot.mapState).toEqual(seedMapState);
    expect(body.listingLedgerRevision).toMatch(/^ledger-/);
  });

  test("GET /api/workspace/client-state returns workspace, map, listings, ledger revision, and planning cache", async () => {
    sessionMock.userId = "user-1";

    const response = await CLIENT_STATE_GET(
      new Request("http://localhost/api/workspace/client-state"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      workspace: {
        id: "workspace-1",
        userId: "user-1",
        name: "Apartment hunt",
        listingLedgerRevision: "ledger-123",
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:00:00.000Z",
      },
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-123",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:00:00.000Z",
      },
      listingLeads: [createLead()],
      listingLedgerRevision: "ledger-123",
      planningThreadCache: createPlanningThreadCache(),
    });
    expect(listingRouteMocks.listWorkspaceListingLeads).toHaveBeenCalledWith("workspace-1");
    expect(planningRouteMocks.listWorkspacePlanningThreadCache).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      mapSnapshot: expect.objectContaining({ id: "snapshot-1" }),
      listingLedgerRevision: "ledger-123",
    });
  });

  test("DELETE /api/workspace rejects signed-out users", async () => {
    const response = await DELETE(createDeleteRequest({ confirmation: "delete" }));

    expect(response.status).toBe(401);
    expect(workspaceRouteMocks.deleteDefaultWorkspaceForUser).not.toHaveBeenCalled();
  });

  test("DELETE /api/workspace rejects cross-site requests", async () => {
    sessionMock.userId = "user-1";

    const response = await DELETE(
      new Request("http://localhost/api/workspace", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ confirmation: "delete" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(workspaceRouteMocks.deleteDefaultWorkspaceForUser).not.toHaveBeenCalled();
  });

  test("DELETE /api/workspace requires explicit confirmation", async () => {
    sessionMock.userId = "user-1";

    const response = await DELETE(createDeleteRequest({ confirmation: "delete workspace" }));

    expect(response.status).toBe(400);
    expect(workspaceRouteMocks.deleteDefaultWorkspaceForUser).not.toHaveBeenCalled();
  });

  test("DELETE /api/workspace deletes the signed-in user's default workspace", async () => {
    sessionMock.userId = "user-1";

    const response = await DELETE(createDeleteRequest({ confirmation: "delete" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(workspaceRouteMocks.deleteDefaultWorkspaceForUser).toHaveBeenCalledWith("user-1");
  });
});

function createDeleteRequest(body: unknown) {
  return new Request("http://localhost/api/workspace", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function createPlanningThreadCache() {
  return {
    thread: {
      id: "thread-1",
      clientInstallationId: "workspace-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:02:00.000Z",
      title: "Apartment planning",
      summary: "",
    },
    messages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Persisted workspace planning note." }],
        createdAt: "2026-06-23T12:01:00.000Z",
      },
    ],
    actionRecords: [],
    contextSummary: emptyContextSummary(),
    contextSummariesByMessageId: {
      "message-1": emptyContextSummary(),
    },
    mapSnapshot: {
      id: "snapshot-1",
      threadId: "thread-1",
      clientInstallationId: "workspace-1",
      mapState: seedMapState,
      revision: "map-123",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-123",
  };
}

function emptyContextSummary() {
  return {
    budget: null,
    beds: null,
    timing: null,
    furnished: null,
    shortTerm: null,
    positiveAnchors: [],
    avoidAnchors: [],
    selectedZones: [],
    sourceStrictness: null,
  };
}

function createLead(): ListingLead {
  return {
    canonicalUrl: "https://example.com/listing",
    firstSeenAt: "2026-06-23T11:00:00.000Z",
    lastSeenAt: "2026-06-23T11:30:00.000Z",
    lastSearchQuery: "mission studio",
    seenCount: 2,
    status: "seen",
    candidate: {
      id: "candidate-1",
      title: "Sunny studio near Dolores",
      url: "https://example.com/listing",
      sourceDomain: "example.com",
      neighborhoodGuess: "Mission Dolores",
      locationText: "Dolores St",
      geocodeQuery: null,
      locationConfidence: "medium",
      coordinates: null,
      geocodeStatus: "not_attempted",
      markerPrecision: "none",
      priceMonthly: 2900,
      beds: "studio",
      shortTermSignal: false,
      furnishedSignal: false,
      fitScore: 4,
      whyItFits: "Walkable to the gym and under budget.",
      citations: [
        {
          url: "https://example.com/listing",
          title: "Listing",
          sourceDomain: "example.com",
        },
      ],
      caveats: [],
    },
  };
}
