import { describe, expect, it } from "vitest";

import type {
  ListingCandidate,
  ListingDisplayCandidate,
  ListingLead,
  ListingSearchFilters,
  MapState,
} from "@/lib/domain/types";
import {
  compareListingDisplayCandidates,
  haversineDistanceMeters,
  pointToLineStringDistanceMeters,
  scoreListingLead,
} from "@/lib/map/listing-planning-score";

const filters: ListingSearchFilters = {
  maxBudget: 3000,
  beds: "studio",
  timing: "",
  shortTerm: false,
  furnished: false,
};

const mapState: MapState = {
  zones: [
    {
      id: "lower-pac-heights",
      name: "Lower Pac Heights",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.44, 37.79],
            [-122.42, 37.79],
            [-122.42, 37.78],
            [-122.44, 37.78],
            [-122.44, 37.79],
          ],
        ],
      },
      fitnessScore: 5,
      affordabilityScore: 4,
      carFreeScore: 5,
      notes: ["Strong planning fit."],
    },
    {
      id: "noise-pocket",
      name: "Noise Pocket",
      kind: "caution",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.422, 37.759],
            [-122.42, 37.759],
            [-122.42, 37.757],
            [-122.422, 37.757],
            [-122.422, 37.759],
          ],
        ],
      },
      fitnessScore: 1,
      affordabilityScore: 2,
      carFreeScore: 2,
      notes: ["Weak planning fit."],
    },
  ],
  areas: [
    {
      id: "lower-pac-heights-area",
      name: "Lower Pac Heights focus area",
      purpose: "Preferred Fillmore-side search area",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.44, 37.79],
            [-122.42, 37.79],
            [-122.42, 37.78],
            [-122.44, 37.78],
            [-122.44, 37.79],
          ],
        ],
      },
      priority: "high",
      influence: "positive",
      notes: ["Strong planning fit."],
    },
    {
      id: "noise-pocket-area",
      name: "Noise Pocket avoid area",
      purpose: "Avoid noise pocket",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.422, 37.759],
            [-122.42, 37.759],
            [-122.42, 37.757],
            [-122.422, 37.757],
            [-122.422, 37.759],
          ],
        ],
      },
      priority: "high",
      influence: "negative",
      notes: ["Weak planning fit."],
    },
  ],
  corridors: [
    {
      id: "fillmore",
      name: "Fillmore",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.433, 37.784],
          [-122.433, 37.792],
        ],
      },
      priority: "high",
      tags: ["transit"],
      notes: ["Core route."],
    },
  ],
  targets: [
    {
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "favorite block",
      coordinates: [-122.433, 37.789],
      priority: "high",
      influence: "positive",
      radiusMinutes: 10,
      notes: ["Anchor this area."],
    },
    {
      id: "avoid-point",
      name: "Avoid Point",
      purpose: "noise pocket",
      coordinates: [-122.421, 37.758],
      priority: "high",
      influence: "negative",
      radiusMinutes: 5,
      notes: [],
    },
  ],
};

function createCandidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    id: "candidate-1",
    title: "Sunny Fillmore Studio",
    url: "https://example.com/listings/1",
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "Fillmore and California",
    geocodeQuery: "Fillmore and California",
    locationConfidence: "medium",
    coordinates: [-122.433, 37.789],
    geocodeStatus: "geocoded_exact",
    markerPrecision: "exact",
    priceMonthly: 2800,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 4,
    whyItFits: "Under budget near a planning anchor.",
    citations: [
      {
        url: "https://example.com/listings/1",
        title: "Listing 1",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
    ...overrides,
  };
}

function createLead(overrides: Partial<ListingLead> = {}): ListingLead {
  const candidate = createCandidate();

  return {
    canonicalUrl: candidate.url,
    firstSeenAt: "2026-06-16T12:00:00.000Z",
    lastSeenAt: "2026-06-16T12:00:00.000Z",
    lastSearchQuery: "Find studios",
    seenCount: 1,
    status: "new",
    candidate,
    ...overrides,
  };
}

function createDisplayCandidate(
  title: string,
  planningScore: ListingDisplayCandidate["planningScore"],
  leadStatus: ListingDisplayCandidate["leadStatus"],
  lastSeenAt: string,
): ListingDisplayCandidate {
  return {
    ...createCandidate({ title }),
    canonicalUrl: `https://example.com/listings/${title.toLowerCase().replace(/\s+/g, "-")}`,
    leadStatus,
    firstSeenAt: "2026-06-16T12:00:00.000Z",
    lastSeenAt,
    seenCount: 1,
    planningScore,
    planningSignals: [],
  };
}

describe("listing planning score", () => {
  it("computes haversine distance between nearby coordinates in meters", () => {
    expect(haversineDistanceMeters([-122.433, 37.789], [-122.433, 37.79])).toBeCloseTo(
      111,
      0,
    );
  });

  it("computes point-to-corridor distance from a point on a vertical Fillmore corridor", () => {
    expect(
      pointToLineStringDistanceMeters([-122.433, 37.789], {
        type: "LineString",
        coordinates: [
          [-122.433, 37.784],
          [-122.433, 37.792],
        ],
      }),
    ).toBeLessThan(5);
  });

  it("scores a strong matching listing as 5 with the strongest planning signals", () => {
    const scored = scoreListingLead({
      lead: createLead(),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });

    expect(scored.planningScore).toBe(5);
    expect(scored.planningSignals).toEqual([
      "Near favorite block",
      "Within budget",
      "Inside preferred area",
    ]);
  });

  it("scores an over-budget listing near a high-priority negative target as 1", () => {
    const scored = scoreListingLead({
      lead: createLead({
        candidate: createCandidate({
          priceMonthly: 3400,
          coordinates: [-122.421, 37.758],
          markerPrecision: "approximate",
          neighborhoodGuess: "Noise Pocket",
        }),
      }),
      filters,
      mapState,
      selectedZoneIds: ["noise-pocket"],
    });

    expect(scored.planningScore).toBe(1);
    expect(scored.planningSignals).toEqual([
      "Over budget",
      "Near avoided noise pocket",
      "Inside avoided area",
    ]);
  });

  it("does not emit a planning signal for approximate pins", () => {
    const scored = scoreListingLead({
      lead: createLead({
        candidate: createCandidate({
          coordinates: [-122.433, 37.789],
          geocodeStatus: "geocoded_approximate",
          markerPrecision: "approximate",
        }),
      }),
      filters: {
        ...filters,
        maxBudget: null,
        beds: "any",
      },
      mapState: {
        ...mapState,
        areas: [],
        corridors: [],
        targets: [],
      },
      selectedZoneIds: [],
    });

    expect(scored.planningSignals).not.toContain("Approximate pin");
    expect(scored.planningSignals).toEqual([]);
  });

  it("scores an ungeocoded listing with unknown price and beds as 3", () => {
    const scored = scoreListingLead({
      lead: createLead({
        candidate: createCandidate({
          coordinates: null,
          geocodeStatus: "not_attempted",
          markerPrecision: "none",
          priceMonthly: null,
          beds: "unknown",
        }),
      }),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });

    expect(scored.planningScore).toBe(3);
    expect(scored.planningSignals).toEqual([
      "Location not pinned yet",
      "Matches preferred area",
      "Bed count unclear",
    ]);
  });

  it("does not match planning areas when an ungeocoded listing has no location text", () => {
    const scored = scoreListingLead({
      lead: createLead({
        candidate: createCandidate({
          coordinates: null,
          geocodeStatus: "not_attempted",
          markerPrecision: "none",
          neighborhoodGuess: "",
          locationText: "",
          priceMonthly: null,
          beds: "unknown",
        }),
      }),
      filters,
      mapState,
      selectedZoneIds: [],
    });

    expect(scored.planningScore).toBe(2);
    expect(scored.planningSignals).toEqual([
      "Location not pinned yet",
      "Bed count unclear",
      "Price needs verification",
    ]);
  });

  it("sorts display candidates by score, status, last seen time, then title", () => {
    const highScoreSeen = createDisplayCandidate(
      "High Score",
      5,
      "seen",
      "2026-06-16T12:00:00.000Z",
    );
    const newLead = createDisplayCandidate("New Lead", 4, "new", "2026-06-16T12:00:00.000Z");
    const recentSeen = createDisplayCandidate(
      "Recent Seen",
      4,
      "seen",
      "2026-06-16T13:00:00.000Z",
    );
    const alphaSeen = createDisplayCandidate(
      "Alpha Seen",
      4,
      "seen",
      "2026-06-16T12:00:00.000Z",
    );
    const zetaSeen = createDisplayCandidate(
      "Zeta Seen",
      4,
      "seen",
      "2026-06-16T12:00:00.000Z",
    );

    expect(
      [zetaSeen, alphaSeen, recentSeen, newLead, highScoreSeen]
        .sort(compareListingDisplayCandidates)
        .map((listing) => listing.title),
    ).toEqual(["High Score", "New Lead", "Recent Seen", "Alpha Seen", "Zeta Seen"]);
  });
});
