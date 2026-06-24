import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ListingLead } from "@/lib/domain/types";

const sessionMock = vi.hoisted(() => ({
  userId: "user-1" as string | null,
}));
const geocodeRouteMocks = vi.hoisted(() => ({
  upsertWorkspaceGeocodeResult: vi.fn(),
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
  upsertWorkspaceGeocodeResult: geocodeRouteMocks.upsertWorkspaceGeocodeResult,
}));

import { POST } from "@/app/api/workspace/geocode-cache/route";

describe("workspace geocode cache route", () => {
  beforeEach(() => {
    sessionMock.userId = "user-1";
    geocodeRouteMocks.upsertWorkspaceGeocodeResult.mockReset();
    geocodeRouteMocks.upsertWorkspaceGeocodeResult.mockResolvedValue({
      ok: true,
      lead: {
        ...createLead(),
        candidate: {
          ...createLead().candidate,
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      },
      cacheEntry: {
        id: "cache-1",
        workspaceId: "workspace-1",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:00:00.000Z",
      },
      listingLedgerRevision: "ledger-2",
    });
  });

  test("POST /api/workspace/geocode-cache rejects cross-site writes", async () => {
    const response = await POST(
      createRequest({
        expectedListingLedgerRevision: "ledger-1",
        canonicalUrl: "https://example.com/listing",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      }, {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(geocodeRouteMocks.upsertWorkspaceGeocodeResult).not.toHaveBeenCalled();
  });

  test("POST /api/workspace/geocode-cache returns 401 for signed-out users", async () => {
    sessionMock.userId = null;

    const response = await POST(
      createRequest({
        expectedListingLedgerRevision: "ledger-1",
        canonicalUrl: "https://example.com/listing",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(geocodeRouteMocks.upsertWorkspaceGeocodeResult).not.toHaveBeenCalled();
  });

  test("POST /api/workspace/geocode-cache returns 409 for stale revisions", async () => {
    geocodeRouteMocks.upsertWorkspaceGeocodeResult.mockResolvedValueOnce({
      ok: false,
      error: "stale_listing_ledger_revision",
      currentListingLedgerRevision: "ledger-2",
    });

    const response = await POST(
      createRequest({
        expectedListingLedgerRevision: "ledger-1",
        canonicalUrl: "https://example.com/listing",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "stale_listing_ledger_revision",
      currentListingLedgerRevision: "ledger-2",
    });
  });

  test("POST /api/workspace/geocode-cache returns the updated lead, cache entry, and new revision", async () => {
    const response = await POST(
      createRequest({
        expectedListingLedgerRevision: "ledger-1",
        canonicalUrl: "https://example.com/listing",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.listingLedgerRevision).toBe("ledger-2");
    expect(body.lead.candidate.coordinates).toEqual([-122.42, 37.77]);
    expect(body.cacheEntry.queryHash).toBe("query-hash-1");
    expect(geocodeRouteMocks.upsertWorkspaceGeocodeResult).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-1",
      queryHash: "query-hash-1",
      query: "123 Main St San Francisco CA",
      result: {
        coordinates: [-122.42, 37.77],
        geocodeQuery: "123 Main St San Francisco CA",
        geocodeStatus: "geocoded_exact",
        locationConfidence: "high",
        markerPrecision: "exact",
        locationText: "123 Main St",
        neighborhoodGuess: "Mission",
      },
    });
  });

  test("POST /api/workspace/geocode-cache returns 404 when the listing is missing", async () => {
    geocodeRouteMocks.upsertWorkspaceGeocodeResult.mockResolvedValueOnce({
      ok: false,
      error: "listing_not_found",
    });

    const response = await POST(
      createRequest({
        expectedListingLedgerRevision: "ledger-1",
        canonicalUrl: "https://example.com/listing",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      ok: false,
      error: "listing_not_found",
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

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/workspace/geocode-cache", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
