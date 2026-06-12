import type { Coordinate, MapState } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { isCoordinateInSfBounds } from "@/lib/map/sf-bounds";
import {
  applyTargetPlanningFieldPatch,
  type TargetPlanningFieldPatch,
} from "@/lib/map/target-points";

export type PersistResult = MapState | null;

export function coordinatesEqual(left: Coordinate[], right: Coordinate[]) {
  return (
    left.length === right.length &&
    left.every(
      (coordinate, index) =>
        coordinate[0] === right[index]?.[0] && coordinate[1] === right[index]?.[1],
    )
  );
}

export function coordinateEqual(left: Coordinate, right: Coordinate) {
  return left[0] === right[0] && left[1] === right[1];
}

export function closeRing(coordinates: Coordinate[]) {
  const first = coordinates[0];
  const last = coordinates.at(-1);

  if (!first || !last || coordinateEqual(first, last)) {
    return coordinates;
  }

  return [...coordinates, first];
}

export function applyZoneGeometryEdit(
  mapState: MapState,
  zoneId: string,
  coordinates: Coordinate[],
): PersistResult {
  const nextCoordinates = closeRing(coordinates);
  const zone = mapState.zones.find((item) => item.id === zoneId);

  if (!zone || coordinatesEqual(zone.geometry.coordinates[0] ?? [], nextCoordinates)) {
    return null;
  }

  return {
    ...mapState,
    zones: mapState.zones.map((item) =>
      item.id === zoneId
        ? {
            ...item,
            geometry: {
              ...item.geometry,
              coordinates: [nextCoordinates],
            },
          }
        : item,
    ),
  };
}

export function applyCorridorGeometryEdit(
  mapState: MapState,
  corridorId: string,
  coordinates: Coordinate[],
): PersistResult {
  const corridor = mapState.corridors.find((item) => item.id === corridorId);

  if (!corridor || coordinatesEqual(corridor.geometry.coordinates, coordinates)) {
    return null;
  }

  return {
    ...mapState,
    corridors: mapState.corridors.map((item) =>
      item.id === corridorId
        ? {
            ...item,
            geometry: {
              ...item.geometry,
              coordinates,
            },
          }
        : item,
    ),
  };
}

export function applyTargetCoordinateEdit(
  mapState: MapState,
  targetId: string,
  coordinates: Coordinate,
): PersistResult {
  const target = mapState.targets.find((item) => item.id === targetId);

  if (!target || coordinateEqual(target.coordinates, coordinates) || !isCoordinateInSfBounds(coordinates)) {
    return null;
  }

  return {
    ...mapState,
    targets: mapState.targets.map((item) =>
      item.id === targetId
        ? {
            ...item,
            name: shouldUseCustomLocationLabel(item, coordinates) ? "Custom location" : item.name,
            coordinates,
          }
        : item,
    ),
  };
}

export function applyTargetPlanningFieldEdit(
  mapState: MapState,
  targetId: string,
  patch: TargetPlanningFieldPatch,
): PersistResult {
  return applyTargetPlanningFieldPatch(mapState, targetId, patch);
}

function shouldUseCustomLocationLabel(
  target: MapState["targets"][number],
  coordinates: Coordinate,
) {
  const seedTarget = seedMapState.targets.find((item) => item.id === target.id);

  return Boolean(
    seedTarget &&
      target.name === seedTarget.name &&
      !coordinateEqual(seedTarget.coordinates, coordinates),
  );
}
