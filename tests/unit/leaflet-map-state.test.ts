import { describe, expect, it } from "vitest";
import { seedMapState } from "@/lib/map/seed-data";
import {
  applyCorridorGeometryEdit,
  applyTargetCoordinateEdit,
  applyZoneGeometryEdit,
} from "@/components/apartment-map/leaflet-map-state";

describe("leaflet map state edits", () => {
  it("updates a zone polygon and closes the edited ring", () => {
    const nextState = applyZoneGeometryEdit(seedMapState, "mission-dolores-valencia", [
      [-122.433, 37.771],
      [-122.414, 37.771],
      [-122.414, 37.751],
      [-122.433, 37.751],
    ]);

    expect(nextState?.zones.find((zone) => zone.id === "mission-dolores-valencia")?.geometry.coordinates[0]).toEqual([
      [-122.433, 37.771],
      [-122.414, 37.771],
      [-122.414, 37.751],
      [-122.433, 37.751],
      [-122.433, 37.771],
    ]);
  });

  it("updates a corridor polyline", () => {
    const nextState = applyCorridorGeometryEdit(seedMapState, "valencia", [
      [-122.422, 37.753],
      [-122.422, 37.77],
    ]);

    expect(nextState?.corridors.find((corridor) => corridor.id === "valencia")?.geometry.coordinates).toEqual([
      [-122.422, 37.753],
      [-122.422, 37.77],
    ]);
  });

  it("updates a target marker coordinate", () => {
    const nextState = applyTargetCoordinateEdit(seedMapState, "valencia-20th", [-122.4225, 37.7595]);

    expect(nextState?.targets.find((target) => target.id === "valencia-20th")?.coordinates).toEqual([
      -122.4225,
      37.7595,
    ]);
  });

  it("returns null when edited geometry does not change", () => {
    const zone = seedMapState.zones.find((item) => item.id === "mission-dolores-valencia");
    const corridor = seedMapState.corridors.find((item) => item.id === "valencia");
    const target = seedMapState.targets.find((item) => item.id === "valencia-20th");

    expect(zone).toBeDefined();
    expect(corridor).toBeDefined();
    expect(target).toBeDefined();

    if (!zone || !corridor || !target) {
      return;
    }

    expect(applyZoneGeometryEdit(seedMapState, zone.id, zone.geometry.coordinates[0])).toBeNull();
    expect(applyCorridorGeometryEdit(seedMapState, corridor.id, corridor.geometry.coordinates)).toBeNull();
    expect(applyTargetCoordinateEdit(seedMapState, target.id, target.coordinates)).toBeNull();
  });
});
