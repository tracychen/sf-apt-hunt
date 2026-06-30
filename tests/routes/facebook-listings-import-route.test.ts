import { beforeEach, describe, expect, test, vi } from "vitest";

import type { FacebookListingImportRequest, ListingLead } from "@/lib/domain/types";

const connectionMocks = vi.hoisted(() => ({
  validateExtensionBearer: vi.fn(),
}));
const importMocks = vi.hoisted(() => ({
  importFacebookListing: vi.fn(),
}));

vi.mock("@/lib/server/extension/connections", () => connectionMocks);

vi.mock("@/lib/server/imports/facebook-listings", () => importMocks);

import { POST } from "@/app/api/imports/facebook-listings/route";

describe("POST /api/imports/facebook-listings", () => {
  beforeEach(() => {
    connectionMocks.validateExtensionBearer.mockReset();
    importMocks.importFacebookListing.mockReset();
    connectionMocks.validateExtensionBearer.mockResolvedValue({
      ok: true,
      userId: "user-1",
      workspaceId: "workspace-1",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    importMocks.importFacebookListing.mockResolvedValue({
      ok: true,
      captureId: "capture-1",
      lead: createLead(),
      listingLedgerRevision: "ledger-2",
    });
  });

  test("rejects missing bearer token", async () => {
    const response = await POST(createImportRequest(createBody(), {}));

    expect(response.status).toBe(401);
    expect(connectionMocks.validateExtensionBearer).not.toHaveBeenCalled();
  });

  test("rejects missing extension id", async () => {
    const response = await POST(
      createImportRequest(createBody(), {
        authorization: "Bearer token-1",
      }),
    );

    expect(response.status).toBe(401);
    expect(connectionMocks.validateExtensionBearer).not.toHaveBeenCalled();
  });

  test("rejects invalid bearer tokens", async () => {
    connectionMocks.validateExtensionBearer.mockResolvedValueOnce({
      ok: false,
      error: "unauthorized",
    });

    const response = await POST(createImportRequest(createBody()));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "unauthorized" });
    expect(importMocks.importFacebookListing).not.toHaveBeenCalled();
  });

  test("rejects oversized import requests", async () => {
    const response = await POST(
      createImportRequest({ ...createBody(), capturedText: "x".repeat(65 * 1024) }),
    );

    expect(response.status).toBe(413);
    expect(importMocks.importFacebookListing).not.toHaveBeenCalled();
  });

  test("rejects non-Facebook URLs", async () => {
    const response = await POST(
      createImportRequest({
        ...createBody(),
        sourcePostUrl: "https://example.com/listing",
      }),
    );

    expect(response.status).toBe(400);
    expect(importMocks.importFacebookListing).not.toHaveBeenCalled();
  });

  test("imports valid Facebook listing into the token workspace", async () => {
    const body = createBody();

    const response = await POST(createImportRequest(body));
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.ok).toBe(true);
    expect(connectionMocks.validateExtensionBearer).toHaveBeenCalledWith({
      token: "token-1",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(importMocks.importFacebookListing).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      request: body,
    });
  });

  test("returns 409 for idempotency conflicts", async () => {
    importMocks.importFacebookListing.mockResolvedValueOnce({
      ok: false,
      error: "idempotency_conflict",
    });

    const response = await POST(createImportRequest(createBody()));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ ok: false, error: "idempotency_conflict" });
  });
});

function createImportRequest(
  body: unknown,
  headers: Record<string, string> = {
    authorization: "Bearer token-1",
    "x-sf-apt-extension-id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
) {
  return new Request("http://localhost/api/imports/facebook-listings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createBody(): FacebookListingImportRequest {
  return {
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    sourceSurface: "groupFeed",
    sourceGroupId: "12345",
    sourceGroupName: "SF Housing",
    sourceGroupUrl: "https://www.facebook.com/groups/12345",
    sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
    capturedText: "Room in Hayes Valley, $1800, available July 15.",
    capturedAt: "2026-06-30T02:00:00.000Z",
    parsedDraft: null,
    reviewedDetails: {
      listingType: "private_room",
      tenancyType: "sublet",
      priceMonthly: 1800,
      bedrooms: 2,
      bathroom: "shared",
      roommateCount: 2,
      locationText: "Hayes Valley",
      neighborhoodGuess: "Hayes Valley",
      availabilityStart: "2026-07-15",
      availabilityEnd: "2026-10-15",
      dateFlexibility: "flexible",
      durationText: "3 months",
      furnished: true,
      pets: "unknown",
      notes: ["Utilities not confirmed"],
    },
    incompleteFlags: [],
  };
}

function createLead(): ListingLead {
  return {
    canonicalUrl: "https://www.facebook.com/groups/12345/posts/67890",
    firstSeenAt: "2026-06-30T02:00:00.000Z",
    lastSeenAt: "2026-06-30T02:00:00.000Z",
    lastSearchQuery: "Facebook listing import",
    seenCount: 1,
    status: "saved",
    candidate: {
      id: "facebook-67890",
      title: "$1,800 private room in Hayes Valley",
      url: "https://www.facebook.com/groups/12345/posts/67890",
      sourceDomain: "facebook.com",
      neighborhoodGuess: "Hayes Valley",
      locationText: "Hayes Valley",
      geocodeQuery: "Hayes Valley",
      locationConfidence: "medium",
      coordinates: null,
      geocodeStatus: "not_attempted",
      markerPrecision: "none",
      priceMonthly: 1800,
      beds: "unknown",
      shortTermSignal: true,
      furnishedSignal: true,
      fitScore: 3,
      whyItFits: "Saved manually from an allowlisted Facebook housing group.",
      citations: [
        {
          url: "https://www.facebook.com/groups/12345/posts/67890",
          title: "SF Housing",
          sourceDomain: "facebook.com",
        },
      ],
      caveats: ["Utilities not confirmed"],
    },
  };
}
