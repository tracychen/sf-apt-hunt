import { describe, expect, it } from "vitest";

import { mapStateSchema } from "@/lib/domain/schemas";
import {
  isCoordinateInSfBounds,
  isLineStringInSfBounds,
  isPolygonInSfBounds,
} from "@/lib/map/sf-bounds";
import { samplePlanningMapState, seedMapState } from "@/lib/map/seed-data";

describe("seedMapState", () => {
  it("validates with mapStateSchema", () => {
    expect(() => mapStateSchema.parse(seedMapState)).not.toThrow();
    expect(() => mapStateSchema.parse(samplePlanningMapState)).not.toThrow();
  });

  it("contains exactly the expected seed zone IDs", () => {
    expect(seedMapState.zones.map((zone) => zone.id).sort()).toEqual([
      "lower-haight-duboce-hayes",
      "lower-pac-heights",
      "marina-cow-hollow",
      "mission-dolores-valencia",
      "nob-hill-polk-gulch",
      "panhandle-nopa",
      "van-ness-lower-russian-hill",
    ]);
  });

  it("keeps all target points inside SF bounds", () => {
    for (const target of samplePlanningMapState.targets) {
      expect(isCoordinateInSfBounds(target.coordinates)).toBe(true);
    }
  });

  it("starts the default map with reference zones only", () => {
    expect(seedMapState.areas).toEqual([]);
    expect(seedMapState.targets).toEqual([]);
    expect(seedMapState.corridors).toEqual([]);
    expect(seedMapState.zones).toHaveLength(samplePlanningMapState.zones.length);

    for (const zone of seedMapState.zones) {
      expect(zone.fitnessScore).toBe(3);
      expect(zone.affordabilityScore).toBe(3);
      expect(zone.carFreeScore).toBe(3);
      expect(zone.notes).toEqual([]);
    }
  });

  it("keeps all zone polygons inside SF bounds with valid ring structure", () => {
    for (const zone of seedMapState.zones) {
      expect(isPolygonInSfBounds(zone.geometry)).toBe(true);
    }
  });

  it("keeps all corridor lines inside SF bounds", () => {
    for (const corridor of samplePlanningMapState.corridors) {
      expect(isLineStringInSfBounds(corridor.geometry)).toBe(true);
    }
  });

  it("rejects coordinates with extra values", () => {
    expect(isCoordinateInSfBounds([-122.433, 37.789, 10])).toBe(false);
  });
});
