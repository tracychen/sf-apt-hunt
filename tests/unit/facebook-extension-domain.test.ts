import { describe, expect, test } from "vitest";

import {
  createExtensionConnectionRequestSchema,
  facebookListingImportRequestSchema,
  housingDetailsSchema,
} from "@/lib/domain/schemas";

describe("Facebook extension domain schemas", () => {
  const validFacebookImportRequest = {
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    sourceSurface: "groupFeed",
    sourceGroupId: "12345",
    sourceGroupName: "SF Housing",
    sourceGroupUrl: "https://www.facebook.com/groups/12345",
    sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
    capturedText: "Room in Hayes Valley, $1800, available July 15.",
    capturedAt: "2026-06-30T02:00:00.000Z",
    parsedDraft: null,
    reviewedDetails: null,
    incompleteFlags: ["missing_bathroom", "missing_roommate_count"],
  };

  test("accepts a complete housing details object with notes", () => {
    expect(
      housingDetailsSchema.parse({
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
        notes: ["Prefers someone quiet", "Utilities not confirmed"],
      }),
    ).toMatchObject({
      listingType: "private_room",
      notes: ["Prefers someone quiet", "Utilities not confirmed"],
    });
  });

  test("rejects invalid Chrome extension ids", () => {
    expect(() =>
      createExtensionConnectionRequestSchema.parse({
        extensionId: "abcdefghijklmnopqrstuvwxyzzzzzzz",
      }),
    ).toThrow();
  });

  test("accepts Facebook import requests with idempotency keys", () => {
    expect(
      facebookListingImportRequestSchema.parse(validFacebookImportRequest),
    ).toMatchObject({
      sourceSurface: "groupFeed",
      incompleteFlags: ["missing_bathroom", "missing_roommate_count"],
    });
  });

  test.each([
    {
      field: "sourceGroupUrl",
      value: "https://example.com/groups/12345",
      description: "non-Facebook host",
    },
    {
      field: "sourcePostUrl",
      value: "https://example.com/groups/12345/posts/67890",
      description: "non-Facebook post host",
    },
    {
      field: "sourceGroupUrl",
      value: "http://www.facebook.com/groups/12345",
      description: "non-HTTPS sourceGroupUrl",
    },
    {
      field: "sourcePostUrl",
      value: "http://www.facebook.com/groups/12345/posts/67890",
      description: "non-HTTPS sourcePostUrl",
    },
  ])("rejects $description", ({ field, value }) => {
    expect(() =>
      facebookListingImportRequestSchema.parse({
        ...validFacebookImportRequest,
        [field]: value,
      }),
    ).toThrow();
  });
});
