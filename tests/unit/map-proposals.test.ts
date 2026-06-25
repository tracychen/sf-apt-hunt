import { describe, expect, it } from "vitest";

import { applyProposal } from "@/lib/map/proposals";
import { samplePlanningMapState } from "@/lib/map/seed-data";

describe("applyProposal", () => {
  it("applies a valid addTarget operation", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Add 16th and Mission.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "sixteenth-mission",
            name: "16th & Mission",
            purpose: "Test planning anchor",
            coordinates: [-122.4197, 37.7651],
            priority: "medium",
            influence: "positive",
            radiusMinutes: 10,
            notes: ["Transit hub; inspect block-by-block."],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.targets.some((target) => target.id === "sixteenth-mission")).toBe(
        true,
      );
      expect(samplePlanningMapState.targets.some((target) => target.id === "sixteenth-mission")).toBe(
        false,
      );
    }
  });

  it("applies valid planning area operations", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Focus Hayes Valley.",
      operations: [
        {
          type: "addArea",
          area: {
            id: "hayes-valley-focus",
            name: "Hayes Valley focus",
            purpose: "Preferred apartment search area around Hayes Valley.",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-122.43, 37.78],
                  [-122.42, 37.78],
                  [-122.42, 37.77],
                  [-122.43, 37.77],
                  [-122.43, 37.78],
                ],
              ],
            },
            priority: "high",
            influence: "positive",
            notes: [],
          },
        },
        {
          type: "updateAreaPlanningFields",
          areaId: "hayes-valley-focus",
          purpose: "Prefer this area for transit access.",
          influence: "positive",
          priority: "medium",
          notes: ["Strong transit access."],
          reason: "User asked to focus here.",
        },
        {
          type: "addNote",
          entityId: "hayes-valley-focus",
          note: "Review listings block by block.",
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.areas?.find((area) => area.id === "hayes-valley-focus")).toMatchObject({
        purpose: "Prefer this area for transit access.",
        priority: "medium",
        influence: "positive",
        notes: ["Strong transit access.", "Review listings block by block."],
      });
    }
  });

  it("rejects invalid coordinates", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Bad point.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "bad",
            name: "Bad",
            purpose: "Invalid test planning anchor",
            coordinates: [-73.9857, 40.7484],
            priority: "low",
            influence: "neutral",
            radiusMinutes: 10,
            notes: [],
          },
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects unknown zone IDs", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Unknown zone.",
      operations: [
        {
          type: "updateZoneScores",
          zoneId: "not-real",
          fitnessScore: 5,
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects replacement geometry outside SF", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Move zone outside SF.",
      operations: [
        {
          type: "replaceZoneGeometry",
          zoneId: "lower-pac-heights",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-73.99, 40.75],
                [-73.98, 40.75],
                [-73.98, 40.74],
                [-73.99, 40.74],
                [-73.99, 40.75],
              ],
            ],
          },
          reason: "Invalid test geometry.",
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects replacement geometry with open or too-short polygon rings", () => {
    const openRingResult = applyProposal(samplePlanningMapState, {
      summary: "Use an open zone polygon.",
      operations: [
        {
          type: "replaceZoneGeometry",
          zoneId: "lower-pac-heights",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.444, 37.794],
                [-122.421, 37.794],
                [-122.421, 37.781],
                [-122.444, 37.781],
              ],
            ],
          },
          reason: "Invalid open test geometry.",
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });
    const tooShortRingResult = applyProposal(samplePlanningMapState, {
      summary: "Use a too-short zone polygon.",
      operations: [
        {
          type: "replaceZoneGeometry",
          zoneId: "lower-pac-heights",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.444, 37.794],
                [-122.421, 37.794],
                [-122.444, 37.794],
              ],
            ],
          },
          reason: "Invalid too-short test geometry.",
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(openRingResult.ok).toBe(false);
    expect(tooShortRingResult.ok).toBe(false);
  });

  it("rejects added target IDs that already exist on zones, areas, or corridors", () => {
    const stateWithArea = {
      ...samplePlanningMapState,
      areas: [
        {
          id: "existing-area",
          name: "Existing area",
          purpose: "Existing area.",
          geometry: samplePlanningMapState.zones[0]?.geometry ?? {
            type: "Polygon",
            coordinates: [],
          },
          priority: "medium" as const,
          influence: "positive" as const,
          notes: [],
        },
      ],
    };
    const existingZoneIdResult = applyProposal(samplePlanningMapState, {
      summary: "Add target with existing zone ID.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "lower-pac-heights",
            name: "Conflicting Target",
            purpose: "Test planning anchor",
            coordinates: [-122.433, 37.789],
            priority: "medium",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });
    const existingCorridorIdResult = applyProposal(samplePlanningMapState, {
      summary: "Add target with existing corridor ID.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "valencia",
            name: "Conflicting Target",
            purpose: "Test planning anchor",
            coordinates: [-122.421, 37.758],
            priority: "medium",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });
    const existingAreaIdResult = applyProposal(stateWithArea, {
      summary: "Add target with existing area ID.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "existing-area",
            name: "Conflicting Target",
            purpose: "Test planning anchor",
            coordinates: [-122.433, 37.789],
            priority: "medium",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });

    expect(existingZoneIdResult.ok).toBe(false);
    expect(existingCorridorIdResult.ok).toBe(false);
    expect(existingAreaIdResult.ok).toBe(false);
  });

  it("rejects added corridor IDs that already exist on zones or targets", () => {
    const existingZoneIdResult = applyProposal(samplePlanningMapState, {
      summary: "Add corridor with existing zone ID.",
      operations: [
        {
          type: "addCorridor",
          corridor: {
            id: "lower-pac-heights",
            name: "Conflicting Corridor",
            geometry: {
              type: "LineString",
              coordinates: [
                [-122.433, 37.781],
                [-122.433, 37.794],
              ],
            },
            priority: "medium",
            tags: ["transit"],
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });
    const existingTargetIdResult = applyProposal(samplePlanningMapState, {
      summary: "Add corridor with existing target ID.",
      operations: [
        {
          type: "addCorridor",
          corridor: {
            id: "valencia-20th",
            name: "Conflicting Corridor",
            geometry: {
              type: "LineString",
              coordinates: [
                [-122.421, 37.752],
                [-122.421, 37.769],
              ],
            },
            priority: "medium",
            tags: ["transit"],
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });

    expect(existingZoneIdResult.ok).toBe(false);
    expect(existingTargetIdResult.ok).toBe(false);
  });

  it("updates corridor and target priority values by ID", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Prioritize Valencia.",
      operations: [
        {
          type: "updateCorridorPriority",
          corridorId: "valencia",
          priority: "high",
          reason: "Fitness density.",
        },
        {
          type: "updateTargetPriority",
          targetId: "valencia-20th",
          priority: "high",
          reason: "Central to selected search.",
        },
      ],
      confidence: "high",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.corridors.find((corridor) => corridor.id === "valencia")?.priority).toBe(
        "high",
      );
      expect(result.state.targets.find((target) => target.id === "valencia-20th")?.priority).toBe(
        "high",
      );
    }
  });

  it("updates target planning fields by ID", () => {
    const result = applyProposal(samplePlanningMapState, {
      summary: "Clarify Valencia target.",
      operations: [
        {
          type: "updateTargetPlanningFields",
          targetId: "valencia-20th",
          purpose: "favorite dinner and fitness block",
          name: "Valencia near 20th",
          influence: "positive",
          priority: "high",
          radiusMinutes: 15,
          notes: ["Use as a planning anchor for Mission listings."],
          reason: "The current pin needs planning context.",
        },
      ],
      confidence: "high",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.targets.find((target) => target.id === "valencia-20th")).toMatchObject({
        purpose: "favorite dinner and fitness block",
        name: "Valencia near 20th",
        influence: "positive",
        priority: "high",
        radiusMinutes: 15,
        notes: ["Use as a planning anchor for Mission listings."],
      });
    }
  });
});
