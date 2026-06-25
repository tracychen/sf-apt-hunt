import type { Coordinate, MapState, MapZone, PlanningArea, PolygonGeometry } from "@/lib/domain/types";

export function getPlanningAreas(mapState: MapState): PlanningArea[] {
  return mapState.areas ?? [];
}

export function createPlanningAreaFromZone(
  zone: MapZone,
  existingAreas: PlanningArea[],
): PlanningArea {
  const baseId = `area-${zone.id}`;
  const existingIds = new Set(existingAreas.map((area) => area.id));

  return {
    id: uniqueAreaId(baseId, existingIds),
    name: `${zone.name} area`,
    purpose: `Preferred apartment search area around ${zone.name}.`,
    geometry: structuredClone(zone.geometry),
    priority: "medium",
    influence: "positive",
    notes: [`Created from the ${zone.name} neighborhood outline.`],
  };
}

export function isPointInPolygon(point: Coordinate, polygon: PolygonGeometry) {
  const outerRing = polygon.coordinates[0] ?? [];

  if (outerRing.length < 4) {
    return false;
  }

  let inside = false;
  const x = point[0];
  const y = point[1];

  for (
    let index = 0, previousIndex = outerRing.length - 1;
    index < outerRing.length;
    previousIndex = index++
  ) {
    const current = outerRing[index];
    const previous = outerRing[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const intersects =
      current[1] > y !== previous[1] > y &&
      x <
        ((previous[0] - current[0]) * (y - current[1])) /
          (previous[1] - current[1]) +
          current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function uniqueAreaId(baseId: string, existingIds: Set<string>) {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const candidateId = `${baseId}-${suffix}`;
    if (!existingIds.has(candidateId)) {
      return candidateId;
    }
  }

  return `${baseId}-${crypto.randomUUID().slice(0, 8)}`;
}
