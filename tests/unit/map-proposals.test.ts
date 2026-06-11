import { describe, expect, it } from "vitest";

import { applyProposal } from "@/lib/map/proposals";
import { seedMapState } from "@/lib/map/seed-data";

describe("applyProposal", () => {
  it("applies a valid addTarget operation", () => {
    const result = applyProposal(seedMapState, {
      summary: "Add 16th and Mission.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "sixteenth-mission",
            name: "16th & Mission",
            coordinates: [-122.4197, 37.7651],
            priority: "medium",
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
      expect(seedMapState.targets.some((target) => target.id === "sixteenth-mission")).toBe(
        false,
      );
    }
  });

  it("rejects invalid coordinates", () => {
    const result = applyProposal(seedMapState, {
      summary: "Bad point.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "bad",
            name: "Bad",
            coordinates: [-73.9857, 40.7484],
            priority: "low",
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
    const result = applyProposal(seedMapState, {
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
    const result = applyProposal(seedMapState, {
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
    const openRingResult = applyProposal(seedMapState, {
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
    const tooShortRingResult = applyProposal(seedMapState, {
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

  it("rejects added target IDs that already exist on zones or corridors", () => {
    const existingZoneIdResult = applyProposal(seedMapState, {
      summary: "Add target with existing zone ID.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "lower-pac-heights",
            name: "Conflicting Target",
            coordinates: [-122.433, 37.789],
            priority: "medium",
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });
    const existingCorridorIdResult = applyProposal(seedMapState, {
      summary: "Add target with existing corridor ID.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "valencia",
            name: "Conflicting Target",
            coordinates: [-122.421, 37.758],
            priority: "medium",
            notes: [],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });

    expect(existingZoneIdResult.ok).toBe(false);
    expect(existingCorridorIdResult.ok).toBe(false);
  });

  it("rejects added corridor IDs that already exist on zones or targets", () => {
    const existingZoneIdResult = applyProposal(seedMapState, {
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
    const existingTargetIdResult = applyProposal(seedMapState, {
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
    const result = applyProposal(seedMapState, {
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
});
