import { describe, expect, it } from "vitest";
import {
  listingSearchResponseSchema,
  mapPatchProposalSchema,
  mapZoneSchema,
  targetCorridorSchema,
  targetPointSchema,
} from "../../lib/domain/schemas";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-122.43, 37.77],
      [-122.42, 37.77],
      [-122.42, 37.76],
      [-122.43, 37.76],
      [-122.43, 37.77],
    ],
  ],
};

describe("domain schemas", () => {
  it("validates a map zone", () => {
    expect(() =>
      mapZoneSchema.parse({
        id: "mission-dolores-valencia",
        name: "Mission Dolores / Valencia",
        kind: "neighborhood",
        geometry: polygon,
        fitnessScore: 5,
        affordabilityScore: 3,
        carFreeScore: 5,
        notes: ["Strong car-free access."],
      }),
    ).not.toThrow();
  });

  it("rejects an invalid priority", () => {
    expect(() =>
      targetCorridorSchema.parse({
        id: "valencia",
        name: "Valencia",
        geometry: {
          type: "LineString",
          coordinates: [
            [-122.421, 37.752],
            [-122.421, 37.769],
          ],
        },
        priority: "urgent",
        tags: ["fitness"],
        notes: [],
      }),
    ).toThrow();
  });

  it("validates target coordinates as longitude latitude", () => {
    expect(() =>
      targetPointSchema.parse({
        id: "fillmore-california",
        name: "Fillmore & California",
        coordinates: [-122.433, 37.789],
        priority: "high",
        notes: [],
      }),
    ).not.toThrow();
  });

  it("requires whyItFits on listing candidates", () => {
    expect(() =>
      listingSearchResponseSchema.parse({
        candidates: [
          {
            id: "listing-1",
            title: "Studio near Fillmore",
            url: "https://example.com/listing-1",
            sourceDomain: "example.com",
            neighborhoodGuess: "Lower Pac Heights",
            locationText: "Fillmore St near California St",
            geocodeQuery: "Fillmore St and California St, San Francisco, CA",
            locationConfidence: "medium",
            coordinates: null,
            geocodeStatus: "not_attempted",
            markerPrecision: "none",
            priceMonthly: 2850,
            beds: "studio",
            shortTermSignal: false,
            furnishedSignal: false,
            fitScore: 4,
            whyItFits: "Within budget and close to target corridor.",
            citations: [
              {
                url: "https://example.com/listing-1",
                title: "Studio near Fillmore",
                sourceDomain: "example.com",
              },
            ],
            caveats: ["Verify availability on source site."],
          },
        ],
        sourceSummary: "One matching listing was found.",
        citations: [
          {
            url: "https://example.com/listing-1",
            title: "Studio near Fillmore",
            sourceDomain: "example.com",
          },
        ],
        caveats: ["Listings can be stale."],
        geocodeAuthorization: {
          nonce: "signed-token",
          expiresAt: "2026-06-11T12:00:00.000Z",
          maxAttempts: 1,
          allowedQueries: [
            {
              candidateId: "listing-1",
              geocodeQueryHash: "hash",
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("validates priority proposal operations", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "Raise Valencia priority.",
        operations: [
          {
            type: "updateCorridorPriority",
            corridorId: "valencia",
            priority: "high",
            reason: "Best fitness and transit fit.",
          },
        ],
        confidence: "high",
        requiresUserReview: true,
      }),
    ).not.toThrow();
  });
});
