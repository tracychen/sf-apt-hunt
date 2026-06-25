import { describe, expect, test } from "vitest";

import type { MapState, OnboardingProgress } from "@/lib/domain/types";
import {
  applyOnboardingOperation,
  completeOnboardingSteps,
  createDefaultOnboardingProgress,
  deriveCompletedOnboardingSteps,
  hasAnchorSemanticEdit,
} from "@/lib/onboarding/progress";

const firstNow = "2026-06-24T12:00:00.000Z";
const secondNow = "2026-06-24T12:05:00.000Z";

describe("onboarding progress", () => {
  test("creates default progress", () => {
    expect(createDefaultOnboardingProgress(firstNow)).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: firstNow,
    });
  });

  test("completes steps idempotently and preserves first timestamp", () => {
    const first = completeOnboardingSteps(
      createDefaultOnboardingProgress(firstNow),
      ["set_ai_key"],
      firstNow,
    );
    const second = completeOnboardingSteps(first, ["set_ai_key", "ask_for_listings"], secondNow);

    expect(second.completedSteps.set_ai_key).toBe(firstNow);
    expect(second.completedSteps.ask_for_listings).toBe(secondNow);
    expect(second.updatedAt).toBe(secondNow);
  });

  test("completeSteps operation merges without removing existing completed steps", () => {
    const progress: OnboardingProgress = {
      ...createDefaultOnboardingProgress(firstNow),
      completedSteps: {
        set_ai_key: firstNow,
      },
    };

    const next = applyOnboardingOperation(
      progress,
      { type: "completeSteps", stepIds: ["review_listing"] },
      secondNow,
    );

    expect(next.completedSteps).toEqual({
      set_ai_key: firstNow,
      review_listing: secondNow,
    });
  });

  test("setPanelState does not alter completed steps", () => {
    const progress: OnboardingProgress = {
      ...createDefaultOnboardingProgress(firstNow),
      completedSteps: {
        set_ai_key: firstNow,
      },
    };

    const next = applyOnboardingOperation(
      progress,
      {
        type: "setPanelState",
        dismissed: true,
        expanded: false,
        lastHighlightedStepId: "ask_for_anchors",
      },
      secondNow,
    );

    expect(next.completedSteps).toEqual({ set_ai_key: firstNow });
    expect(next.dismissed).toBe(true);
    expect(next.expanded).toBe(false);
    expect(next.lastHighlightedStepId).toBe("ask_for_anchors");
  });

  test("reset clears completed steps", () => {
    const progress: OnboardingProgress = {
      ...createDefaultOnboardingProgress(firstNow),
      completedSteps: {
        set_ai_key: firstNow,
        review_listing: firstNow,
      },
      dismissed: true,
      expanded: false,
    };

    expect(applyOnboardingOperation(progress, { type: "reset" }, secondNow)).toEqual(
      createDefaultOnboardingProgress(secondNow),
    );
  });

  test("derives completion from strong state signals only", () => {
    expect(
      deriveCompletedOnboardingSteps({
        apiKey: "sk-test",
        planningThreadCache: {
          messages: [
            {
              id: "message-1",
              threadId: "thread-1",
              role: "assistant",
              createdAt: firstNow,
              parts: [
                { type: "text", text: "Listings found." },
                {
                  type: "listingResults",
                  resultSetId: "results-1",
                  sourceSummary: "One listing matched.",
                  caveats: [],
                  geocodeAuthorization: null,
                  listings: [],
                },
              ],
            },
          ],
          actionRecords: [],
        },
        listingLeads: [
          {
            canonicalUrl: "https://example.com/listing",
            firstSeenAt: firstNow,
            lastSeenAt: firstNow,
            lastSearchQuery: "Find listings",
            seenCount: 1,
            status: "saved",
            candidate: {
              id: "candidate-1",
              title: "Listing",
              url: "https://example.com/listing",
              sourceDomain: "example.com",
              neighborhoodGuess: "Mission",
              locationText: null,
              geocodeQuery: null,
              locationConfidence: "none",
              coordinates: null,
              geocodeStatus: "not_attempted",
              markerPrecision: "none",
              priceMonthly: null,
              beds: "unknown",
              shortTermSignal: false,
              furnishedSignal: false,
              fitScore: 3,
              whyItFits: "Potential fit.",
              citations: [],
              caveats: [],
            },
          },
        ],
      }),
    ).toEqual(["set_ai_key", "ask_for_listings", "review_listing"]);
  });

  test("detects semantic anchor edits without treating geometry-only changes as semantic", () => {
    expect(
      hasAnchorSemanticEdit(baseMapState, {
        ...baseMapState,
        targets: baseMapState.targets.map((target) =>
          target.id === "target-1" ? { ...target, purpose: "Morning workouts" } : target,
        ),
      }),
    ).toBe(true);

    expect(
      hasAnchorSemanticEdit(baseMapState, {
        ...baseMapState,
        corridors: baseMapState.corridors.map((corridor) =>
          corridor.id === "corridor-1" ? { ...corridor, notes: ["Frequent transit."] } : corridor,
        ),
      }),
    ).toBe(true);

    expect(
      hasAnchorSemanticEdit(baseMapState, {
        ...baseMapState,
        targets: baseMapState.targets.map((target) =>
          target.id === "target-1" ? { ...target, coordinates: [-122.421, 37.761] } : target,
        ),
        corridors: baseMapState.corridors.map((corridor) =>
          corridor.id === "corridor-1"
            ? {
                ...corridor,
                geometry: {
                  ...corridor.geometry,
                  coordinates: [
                    [-122.424, 37.76],
                    [-122.418, 37.766],
                  ],
                },
              }
            : corridor,
        ),
      }),
    ).toBe(false);
  });

  test("derives edit_anchor_meaning only from semantic map state changes", () => {
    expect(
      deriveCompletedOnboardingSteps({
        apiKey: null,
        listingLeads: [],
        previousMapState: baseMapState,
        mapState: {
          ...baseMapState,
          targets: baseMapState.targets.map((target) =>
            target.id === "target-1" ? { ...target, priority: "high" } : target,
          ),
        },
      }),
    ).toEqual(["edit_anchor_meaning"]);

    expect(
      deriveCompletedOnboardingSteps({
        apiKey: null,
        listingLeads: [],
        previousMapState: baseMapState,
        mapState: {
          ...baseMapState,
          targets: baseMapState.targets.map((target) =>
            target.id === "target-1" ? { ...target, coordinates: [-122.421, 37.761] } : target,
          ),
        },
      }),
    ).toEqual([]);
  });
});

const baseMapState: MapState = {
  zones: [],
  corridors: [
    {
      id: "corridor-1",
      name: "Valencia",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.424, 37.76],
          [-122.42, 37.764],
        ],
      },
      priority: "medium",
      tags: ["transit"],
      notes: [],
    },
  ],
  targets: [
    {
      id: "target-1",
      name: "Gym",
      purpose: "Fitness",
      coordinates: [-122.422, 37.76],
      priority: "medium",
      influence: "positive",
      radiusMinutes: 10,
      notes: [],
    },
  ],
};
