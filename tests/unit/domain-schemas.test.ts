import { describe, expect, it, vi } from "vitest";
import {
  listingCandidateSchema,
  listingSearchResponseSchema,
  mapAssistantOutcomeSchema,
  mapPatchProposalSchema,
  mapStateSchema,
  mapZoneSchema,
  researchedTargetCandidateSchema,
  targetCorridorSchema,
  targetPointSchema,
} from "@/lib/domain/schemas";
import { dedupeResearchedTargetCandidates } from "@/lib/map/researched-candidates";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";

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
        purpose: "Lower Pac Heights reference point",
        coordinates: [-122.433, 37.789],
        priority: "high",
        influence: "positive",
        radiusMinutes: 10,
        notes: [],
      }),
    ).not.toThrow();
  });

  it("validates target planning fields", () => {
    expect(() =>
      targetPointSchema.parse({
        id: "fillmore-california",
        name: "Fillmore & California",
        purpose: "favorite block",
        coordinates: [-122.433, 37.789],
        priority: "high",
        influence: "positive",
        radiusMinutes: 10,
        notes: [],
      }),
    ).not.toThrow();
  });

  it("rejects researched target candidates with model-supplied coordinates", () => {
    expect(() =>
      researchedTargetCandidateSchema.parse({
        id: "otf-financial-district",
        name: "Orangetheory Fitness Financial District",
        address: "123 Battery St, San Francisco, CA",
        geocodeQuery: "Orangetheory Fitness Financial District, San Francisco, CA",
        coordinates: [-122.409, 37.789],
        source: {
          url: "https://example.com/orangetheory",
          title: "Orangetheory",
          sourceDomain: "example.com",
        },
        purpose: "fitness studio",
        influence: "positive",
        priority: "high",
        radiusMinutes: 10,
        confidence: "high",
        caveats: [],
      }),
    ).toThrow();
  });

  it("rejects target coordinates outside San Francisco", () => {
    expect(() =>
      targetPointSchema.parse({
        id: "outside-sf",
        name: "Outside SF",
        purpose: "not a San Francisco planning anchor",
        coordinates: [-73.9857, 40.7484],
        priority: "low",
        influence: "neutral",
        radiusMinutes: 10,
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects non-http(s) listing and citation URLs", () => {
    const baseCandidate = {
      id: "listing-1",
      title: "Studio near Fillmore",
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
        { url: "https://example.com/listing-1", title: "Studio", sourceDomain: "example.com" },
      ],
      caveats: [],
    };

    for (const badUrl of [
      "javascript:alert(document.cookie)",
      "data:text/html,<script>1</script>",
      "vbscript:msgbox(1)",
    ]) {
      expect(() => listingCandidateSchema.parse({ ...baseCandidate, url: badUrl })).toThrow();
    }

    expect(() =>
      listingCandidateSchema.parse({ ...baseCandidate, url: "https://example.com/listing-1" }),
    ).not.toThrow();
    expect(() =>
      listingCandidateSchema.parse({ ...baseCandidate, url: "http://example.com/listing-1" }),
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

  it("validates generated geocode authorization tokens at the v1 query cap", () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const candidates = Array.from({ length: 10 }, (_, index) => ({
      id: `listing-${index + 1}`,
      geocodeQuery: `${100 + index} Market St`,
    }));
    const geocodeAuthorization = createGeocodeAuthorization({
      secret: "test-secret",
      candidates,
      maxAttempts: 10,
      ttlSeconds: 60,
    });

    expect(geocodeAuthorization.allowedQueries).toHaveLength(10);
    expect(() =>
      listingSearchResponseSchema.parse({
        candidates: [
          {
            id: "listing-1",
            title: "Studio near Market",
            url: "https://example.com/listing-1",
            sourceDomain: "example.com",
            neighborhoodGuess: "SoMa",
            locationText: "100 Market St",
            geocodeQuery: "100 Market St",
            locationConfidence: "medium",
            coordinates: null,
            geocodeStatus: "not_attempted",
            markerPrecision: "none",
            priceMonthly: 2850,
            beds: "studio",
            shortTermSignal: false,
            furnishedSignal: false,
            fitScore: 4,
            whyItFits: "Within budget and close to transit.",
            citations: [
              {
                url: "https://example.com/listing-1",
                title: "Studio near Market",
                sourceDomain: "example.com",
              },
            ],
            caveats: [],
          },
        ],
        sourceSummary: "One matching listing was found.",
        citations: [
          {
            url: "https://example.com/listing-1",
            title: "Studio near Market",
            sourceDomain: "example.com",
          },
        ],
        caveats: [],
        geocodeAuthorization,
      }),
    ).not.toThrow();
  });

  it("rejects generated geocode authorization tokens above the v1 query cap", () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const geocodeAuthorization = createGeocodeAuthorization({
      secret: "test-secret",
      candidates: Array.from({ length: 11 }, (_, index) => ({
        id: `listing-${index + 1}`,
        geocodeQuery: `${100 + index} Market St`,
      })),
      maxAttempts: 11,
      ttlSeconds: 60,
    });

    expect(geocodeAuthorization.allowedQueries).toHaveLength(11);
    expect(() =>
      listingSearchResponseSchema.parse({
        candidates: [],
        sourceSummary: "",
        citations: [],
        caveats: [],
        geocodeAuthorization,
      }),
    ).toThrow();
  });

  it("requires listing prices to be positive integers", () => {
    const candidate = {
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
      priceMonthly: 2850.5,
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
    };

    expect(() => listingCandidateSchema.parse(candidate)).toThrow();
    expect(() => listingCandidateSchema.parse({ ...candidate, priceMonthly: 0 })).toThrow();
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

  it("validates target planning field proposal operations", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "Update a target planning anchor.",
        operations: [
          {
            type: "updateTargetPlanningFields",
            targetId: "valencia-20th",
            purpose: "favorite block",
            influence: "positive",
            radiusMinutes: 15,
            reason: "This point should describe why it matters.",
          },
        ],
        confidence: "high",
        requiresUserReview: true,
      }),
    ).not.toThrow();
  });

  it("rejects target planning field proposal operations without a field change", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "No target field changes.",
        operations: [
          {
            type: "updateTargetPlanningFields",
            targetId: "valencia-20th",
            reason: "No editable field was supplied.",
          },
        ],
        confidence: "low",
        requiresUserReview: true,
      }),
    ).toThrow();
  });

  it("rejects researched assistant summaries that reference absent operations", () => {
    expect(() =>
      mapAssistantOutcomeSchema.parse({
        kind: "proposal",
        assistantMessage: "Review this researched target.",
        proposal: {
          summary: "No matching operations.",
          operations: [],
          confidence: "medium",
          requiresUserReview: true,
        },
        researchSummary: {
          items: [
            {
              entityId: "missing-target",
              operationType: "addTarget",
              label: "Missing target",
              source: {
                url: "https://example.com/missing",
                title: "Missing",
                sourceDomain: "example.com",
              },
              confidence: "medium",
              geocodePrecision: "approximate",
              caveats: [],
            },
          ],
          exclusions: [],
          caveats: [],
        },
      }),
    ).toThrow();
  });

  it("deduplicates researched target candidates by normalized address", () => {
    const baseCandidate = {
      id: "studio-a",
      name: "Fitness Studio A",
      address: "123 Battery St, San Francisco, CA",
      geocodeQuery: "123 Battery Street, San Francisco, CA",
      source: {
        url: "https://example.com/studio-a",
        title: "Studio A",
        sourceDomain: "example.com",
      },
      purpose: "fitness studio",
      influence: "positive" as const,
      priority: "high" as const,
      radiusMinutes: 10 as const,
      confidence: "high" as const,
      caveats: [],
    };

    const result = dedupeResearchedTargetCandidates({
      mapState: {
        zones: [],
        corridors: [],
        targets: [],
      },
      candidates: [
        { candidate: baseCandidate, coordinates: [-122.4, 37.79] },
        {
          candidate: {
            ...baseCandidate,
            id: "studio-b",
            source: {
              url: "https://example.com/studio-b",
              title: "Studio B",
              sourceDomain: "example.com",
            },
          },
          coordinates: [-122.4001, 37.7901],
        },
      ],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.exclusions).toEqual([
      expect.objectContaining({
        label: "Fitness Studio A",
        reason: "duplicate",
      }),
    ]);
  });

  it("caps map state collection sizes", () => {
    const zone = {
      id: "mission-dolores-valencia",
      name: "Mission Dolores / Valencia",
      kind: "neighborhood",
      geometry: polygon,
      fitnessScore: 5,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Strong car-free access."],
    };

    expect(() =>
      mapStateSchema.parse({
        zones: Array.from({ length: 101 }, (_, index) => ({
          ...zone,
          id: `zone-${index}`,
        })),
        corridors: [],
        targets: [],
      }),
    ).toThrow();
  });

  it("caps proposal operation counts and free text", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "Too many operations.",
        operations: Array.from({ length: 51 }, () => ({
          type: "updateZoneScores",
          zoneId: "lower-pac-heights",
          carFreeScore: 5,
        })),
        confidence: "low",
        requiresUserReview: true,
      }),
    ).toThrow();

    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "x".repeat(4_001),
        operations: [],
        confidence: "low",
        requiresUserReview: true,
      }),
    ).toThrow();
  });

  it("caps note counts and note length", () => {
    expect(() =>
      mapZoneSchema.parse({
        id: "mission-dolores-valencia",
        name: "Mission Dolores / Valencia",
        kind: "neighborhood",
        geometry: polygon,
        fitnessScore: 5,
        affordabilityScore: 3,
        carFreeScore: 5,
        notes: Array.from({ length: 51 }, (_, index) => `Note ${index}`),
      }),
    ).toThrow();

    expect(() =>
      targetPointSchema.parse({
        id: "fillmore-california",
        name: "Fillmore & California",
        purpose: "Lower Pac Heights reference point",
        coordinates: [-122.433, 37.789],
        priority: "high",
        influence: "positive",
        radiusMinutes: 10,
        notes: ["x".repeat(2_001)],
      }),
    ).toThrow();
  });
});
