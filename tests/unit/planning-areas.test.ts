import { describe, expect, it } from "vitest";

import type { MapState } from "@/lib/domain/types";
import {
  createPlanningAreaFromZone,
  getPlanningAreas,
  isPointInPolygon,
} from "@/lib/map/planning-areas";
import { samplePlanningMapState } from "@/lib/map/seed-data";

describe("planning area helpers", () => {
  it("treats missing areas as an empty collection", () => {
    const legacyState: MapState = {
      zones: [],
      corridors: [],
      targets: [],
    };

    expect(getPlanningAreas(legacyState)).toEqual([]);
  });

  it("creates a preferred planning area from a neighborhood outline", () => {
    const zone = samplePlanningMapState.zones.find((item) => item.id === "lower-pac-heights");
    expect(zone).toBeDefined();

    if (!zone) {
      return;
    }

    expect(createPlanningAreaFromZone(zone, [])).toEqual({
      id: "area-lower-pac-heights",
      name: "Lower Pac Heights area",
      purpose: "Preferred apartment search area around Lower Pac Heights.",
      geometry: zone.geometry,
      priority: "medium",
      influence: "positive",
      notes: ["Created from the Lower Pac Heights neighborhood outline."],
    });
  });

  it("deduplicates area IDs created from the same neighborhood outline", () => {
    const zone = samplePlanningMapState.zones.find((item) => item.id === "lower-pac-heights");
    expect(zone).toBeDefined();

    if (!zone) {
      return;
    }

    expect(
      createPlanningAreaFromZone(zone, [
        {
          id: "area-lower-pac-heights",
          name: "Lower Pac Heights area",
          purpose: "Preferred apartment search area around Lower Pac Heights.",
          geometry: zone.geometry,
          priority: "medium",
          influence: "positive",
          notes: [],
        },
      ]).id,
    ).toBe("area-lower-pac-heights-2");
  });

  it("detects whether a point is inside a planning area polygon", () => {
    const zone = samplePlanningMapState.zones.find((item) => item.id === "lower-pac-heights");
    expect(zone).toBeDefined();

    if (!zone) {
      return;
    }

    expect(isPointInPolygon([-122.433, 37.789], zone.geometry)).toBe(true);
    expect(isPointInPolygon([-122.39, 37.789], zone.geometry)).toBe(false);
  });
});
