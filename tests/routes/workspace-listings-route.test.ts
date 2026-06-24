import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ListingLead } from "@/lib/domain/types";

const sessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));
const listingRouteMocks = vi.hoisted(() => ({
  listWorkspaceListingLeads: vi.fn(),
  updateWorkspaceListingStatus: vi.fn(),
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
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
  }),
}));

vi.mock("@/lib/server/listing-leads-db", () => ({
  listWorkspaceListingLeads: listingRouteMocks.listWorkspaceListingLeads,
  updateWorkspaceListingStatus: listingRouteMocks.updateWorkspaceListingStatus,
}));

import { GET } from "@/app/api/workspace/listings/route";
import { PATCH } from "@/app/api/workspace/listings/[id]/route";

describe("workspace listing routes", () => {
  beforeEach(() => {
    sessionMock.userId = null;
    listingRouteMocks.listWorkspaceListingLeads.mockReset();
    listingRouteMocks.updateWorkspaceListingStatus.mockReset();
    listingRouteMocks.listWorkspaceListingLeads.mockResolvedValue({
      leads: [createLead()],
      listingLedgerRevision: "ledger-1",
    });
    listingRouteMocks.updateWorkspaceListingStatus.mockResolvedValue({
      ok: true,
      lead: {
        ...createLead(),
        status: "saved",
      },
      listingLedgerRevision: "ledger-2",
    });
  });

  test("GET /api/workspace/listings returns 401 for signed-out users", async () => {
    const response = await GET(new Request("http://localhost/api/workspace/listings"));

    expect(response.status).toBe(401);
  });

  test("GET /api/workspace/listings returns leads and the listing ledger revision", async () => {
    sessionMock.userId = "user-1";

    const response = await GET(new Request("http://localhost/api/workspace/listings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      leads: [createLead()],
      listingLedgerRevision: "ledger-1",
    });
    expect(listingRouteMocks.listWorkspaceListingLeads).toHaveBeenCalledWith("workspace-1");
  });

  test("PATCH /api/workspace/listings/[id] returns 409 for stale revisions", async () => {
    sessionMock.userId = "user-1";
    listingRouteMocks.updateWorkspaceListingStatus.mockResolvedValueOnce({
      ok: false,
      error: "stale_listing_ledger_revision",
      currentListingLedgerRevision: "ledger-2",
    });

    const response = await PATCH(
      createPatchRequest("https://example.com/listing", {
        expectedListingLedgerRevision: "ledger-1",
        status: "saved",
      }),
      {
        params: Promise.resolve({
          id: encodeURIComponent("https://example.com/listing"),
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "stale_listing_ledger_revision",
      currentListingLedgerRevision: "ledger-2",
    });
  });

  test("PATCH /api/workspace/listings/[id] rejects cross-site writes", async () => {
    sessionMock.userId = "user-1";

    const response = await PATCH(
      createPatchRequest(
        "https://example.com/listing",
        {
          expectedListingLedgerRevision: "ledger-1",
          status: "saved",
        },
        {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      ),
      {
        params: Promise.resolve({
          id: encodeURIComponent("https://example.com/listing"),
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(listingRouteMocks.updateWorkspaceListingStatus).not.toHaveBeenCalled();
  });

  test("PATCH /api/workspace/listings/[id] returns 404 when dismissing a saved listing", async () => {
    sessionMock.userId = "user-1";
    listingRouteMocks.updateWorkspaceListingStatus.mockResolvedValueOnce({
      ok: false,
      error: "listing_not_found",
    });

    const response = await PATCH(
      createPatchRequest("https://example.com/listing", {
        expectedListingLedgerRevision: "ledger-1",
        status: "dismissed",
      }),
      {
        params: Promise.resolve({
          id: encodeURIComponent("https://example.com/listing"),
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      ok: false,
      error: "listing_not_found",
    });
  });

  test("PATCH /api/workspace/listings/[id] returns the updated lead and new revision", async () => {
    sessionMock.userId = "user-1";

    const response = await PATCH(
      createPatchRequest("https://example.com/listing", {
        expectedListingLedgerRevision: "ledger-1",
        status: "saved",
      }),
      {
        params: Promise.resolve({
          id: encodeURIComponent("https://example.com/listing"),
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      lead: {
        ...createLead(),
        status: "saved",
      },
      listingLedgerRevision: "ledger-2",
    });
    expect(listingRouteMocks.updateWorkspaceListingStatus).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-1",
      status: "saved",
    });
  });
});

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

function createPatchRequest(canonicalUrl: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/workspace/listings/${encodeURIComponent(canonicalUrl)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
