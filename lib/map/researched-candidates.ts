import type {
  Coordinate,
  LineStringGeometry,
  MapState,
  ResearchExclusion,
  ResearchedCorridorCandidate,
  ResearchedTargetCandidate,
} from "@/lib/domain/types";

const MAX_RESEARCH_ENTITY_ID_LENGTH = 128;
const DEFAULT_TARGET_DUPLICATE_DISTANCE_METERS = 50;
const DEFAULT_CORRIDOR_GEOMETRY_DISTANCE_METERS = 50;
const DEFAULT_CORRIDOR_GEOMETRY_HAUSDORFF_METERS = 100;
const EARTH_RADIUS_METERS = 6_371_000;

type MapEntityIdState = Pick<MapState, "zones" | "corridors" | "targets">;

export type ResearchedTargetDeduplicationInput = {
  candidate: ResearchedTargetCandidate;
  coordinates?: Coordinate | null;
};

export type ResearchedCorridorDeduplicationInput = {
  candidate: ResearchedCorridorCandidate;
  geometry?: LineStringGeometry | null;
};

export type ResearchedDeduplicationResult<T> = {
  accepted: T[];
  exclusions: ResearchExclusion[];
};

export function createUniqueResearchEntityId({
  candidateId,
  candidateName,
  existingIds = [],
  prefix,
  maxLength = MAX_RESEARCH_ENTITY_ID_LENGTH,
}: {
  candidateId?: string | null;
  candidateName: string;
  existingIds?: Iterable<string>;
  prefix?: string;
  maxLength?: number;
}) {
  const seenIds = new Set(existingIds);
  const prefixSlug = prefix ? slugifyResearchId(prefix) : "";
  const baseSlug =
    slugifyResearchId(candidateId ?? "") ||
    slugifyResearchId(candidateName) ||
    prefixSlug ||
    "research";
  const prefixedBase =
    prefixSlug.length > 0 && !baseSlug.startsWith(`${prefixSlug}-`)
      ? `${prefixSlug}-${baseSlug}`
      : baseSlug;
  const effectiveMaxLength = Math.max(1, Math.min(maxLength, MAX_RESEARCH_ENTITY_ID_LENGTH));
  const base = truncateResearchId(prefixedBase, effectiveMaxLength);

  if (!seenIds.has(base)) {
    return base;
  }

  for (let suffixIndex = 2; suffixIndex <= 10_000; suffixIndex += 1) {
    const suffix = `-${suffixIndex}`;
    const stemLength = Math.max(1, effectiveMaxLength - suffix.length);
    const candidate = `${truncateResearchId(prefixedBase, stemLength)}${suffix}`.slice(
      0,
      effectiveMaxLength,
    );

    if (!seenIds.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to create a unique research entity id.");
}

export function dedupeResearchedTargetCandidates<T extends ResearchedTargetDeduplicationInput>({
  mapState,
  candidates,
  existingSourceUrls = [],
  duplicateDistanceMeters = DEFAULT_TARGET_DUPLICATE_DISTANCE_METERS,
}: {
  mapState: MapEntityIdState;
  candidates: T[];
  existingSourceUrls?: Iterable<string>;
  duplicateDistanceMeters?: number;
}): ResearchedDeduplicationResult<T> {
  const seenIds = collectMapEntityIds(mapState);
  const seenSourceUrls = new Set(Array.from(existingSourceUrls, canonicalizeResearchSourceUrl));
  const seenAddressOrQueryKeys = new Set<string>();
  const acceptedTargetLocations = mapState.targets.map((target) => ({
    label: target.name,
    nameKey: normalizeResearchText(target.name),
    coordinates: target.coordinates,
  }));
  const accepted: T[] = [];
  const exclusions: ResearchExclusion[] = [];

  for (const item of candidates) {
    const idExclusion = getDuplicateIdExclusion(item.candidate.id, item.candidate.name);

    if (seenIds.has(item.candidate.id)) {
      exclusions.push({
        ...idExclusion,
        source: item.candidate.source,
      });
      continue;
    }

    const sourceKey = canonicalizeResearchSourceUrl(item.candidate.source.url);
    if (seenSourceUrls.has(sourceKey)) {
      exclusions.push({
        label: item.candidate.name,
        reason: "duplicate",
        source: item.candidate.source,
        caveats: ["A researched target from this source URL was already included."],
      });
      continue;
    }

    const addressOrQueryKey = createTargetAddressOrQueryKey(item.candidate);
    if (seenAddressOrQueryKeys.has(addressOrQueryKey)) {
      exclusions.push({
        label: item.candidate.name,
        reason: "duplicate",
        source: item.candidate.source,
        caveats: ["A researched target with this normalized address or query was already included."],
      });
      continue;
    }

    if (
      item.coordinates &&
      hasNearbyTargetWithSameName({
        targetLocations: acceptedTargetLocations,
        candidateName: item.candidate.name,
        coordinates: item.coordinates,
        duplicateDistanceMeters,
      })
    ) {
      exclusions.push({
        label: item.candidate.name,
        reason: "duplicate",
        source: item.candidate.source,
        caveats: ["A target with the same normalized name is already near this coordinate."],
      });
      continue;
    }

    accepted.push(item);
    seenIds.add(item.candidate.id);
    seenSourceUrls.add(sourceKey);
    seenAddressOrQueryKeys.add(addressOrQueryKey);

    if (item.coordinates) {
      acceptedTargetLocations.push({
        label: item.candidate.name,
        nameKey: normalizeResearchText(item.candidate.name),
        coordinates: item.coordinates,
      });
    }
  }

  return { accepted, exclusions };
}

export function dedupeResearchedCorridorCandidates<
  T extends ResearchedCorridorDeduplicationInput,
>({
  mapState,
  candidates,
  existingSourceUrls = [],
}: {
  mapState: MapEntityIdState;
  candidates: T[];
  existingSourceUrls?: Iterable<string>;
}): ResearchedDeduplicationResult<T> {
  const seenIds = collectMapEntityIds(mapState);
  const seenSourceUrls = new Set(Array.from(existingSourceUrls, canonicalizeResearchSourceUrl));
  const seenNames = new Set(mapState.corridors.map((corridor) => normalizeResearchText(corridor.name)));
  const acceptedGeometries = mapState.corridors.map((corridor) => ({
    label: corridor.name,
    geometry: corridor.geometry,
  }));
  const accepted: T[] = [];
  const exclusions: ResearchExclusion[] = [];

  for (const item of candidates) {
    if (seenIds.has(item.candidate.id)) {
      exclusions.push({
        ...getDuplicateIdExclusion(item.candidate.id, item.candidate.name),
        source: item.candidate.source,
      });
      continue;
    }

    const sourceKeys = collectCorridorSourceKeys(item.candidate);
    if (sourceKeys.some((sourceKey) => seenSourceUrls.has(sourceKey))) {
      exclusions.push({
        label: item.candidate.name,
        reason: "duplicate",
        source: item.candidate.source,
        caveats: ["A researched corridor from this source URL was already included."],
      });
      continue;
    }

    const nameKey = normalizeResearchText(item.candidate.name);
    if (seenNames.has(nameKey)) {
      exclusions.push({
        label: item.candidate.name,
        reason: "duplicate",
        source: item.candidate.source,
        caveats: ["A corridor with this normalized name was already included."],
      });
      continue;
    }

    const geometry = getResearchedCorridorLineString(item);
    if (
      geometry &&
      acceptedGeometries.some((acceptedGeometry) =>
        areLineStringsBasicallyEquivalent(acceptedGeometry.geometry, geometry),
      )
    ) {
      exclusions.push({
        label: item.candidate.name,
        reason: "duplicate",
        source: item.candidate.source,
        caveats: ["A corridor with equivalent basic geometry was already included."],
      });
      continue;
    }

    accepted.push(item);
    seenIds.add(item.candidate.id);
    sourceKeys.forEach((sourceKey) => seenSourceUrls.add(sourceKey));
    seenNames.add(nameKey);

    if (geometry) {
      acceptedGeometries.push({ label: item.candidate.name, geometry });
    }
  }

  return { accepted, exclusions };
}

export function getResearchedCorridorLineString({
  candidate,
  geometry,
}: ResearchedCorridorDeduplicationInput): LineStringGeometry | null {
  if (geometry) {
    return geometry;
  }

  if (candidate.geometry.kind !== "modelLineString") {
    return null;
  }

  return {
    type: "LineString",
    coordinates: candidate.geometry.coordinates,
  };
}

export function normalizeResearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeResearchSourceUrl(value: string) {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || lowerKey === "gclid" || lowerKey === "fbclid") {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";

    return url.toString();
  } catch {
    return normalizeResearchText(trimmed);
  }
}

export function areLineStringsBasicallyEquivalent(
  left: LineStringGeometry,
  right: LineStringGeometry,
  {
    pointDistanceMeters = DEFAULT_CORRIDOR_GEOMETRY_DISTANCE_METERS,
    hausdorffDistanceMeters = DEFAULT_CORRIDOR_GEOMETRY_HAUSDORFF_METERS,
  }: {
    pointDistanceMeters?: number;
    hausdorffDistanceMeters?: number;
  } = {},
) {
  if (left.coordinates.length < 2 || right.coordinates.length < 2) {
    return false;
  }

  if (left.coordinates.length === right.coordinates.length) {
    return (
      coordinatesMatchInOrder(left.coordinates, right.coordinates, pointDistanceMeters) ||
      coordinatesMatchInOrder(left.coordinates, [...right.coordinates].reverse(), pointDistanceMeters)
    );
  }

  const endpointsMatch =
    endpointsMatchWithinDistance(left.coordinates, right.coordinates, pointDistanceMeters) ||
    endpointsMatchWithinDistance(left.coordinates, [...right.coordinates].reverse(), pointDistanceMeters);

  return (
    endpointsMatch &&
    maxNearestPointDistance(left.coordinates, right.coordinates) <= hausdorffDistanceMeters &&
    maxNearestPointDistance(right.coordinates, left.coordinates) <= hausdorffDistanceMeters
  );
}

function slugifyResearchId(value: string) {
  return normalizeResearchText(value).replace(/\s+/g, "-");
}

function truncateResearchId(value: string, maxLength: number) {
  return value.slice(0, maxLength).replace(/-+$/, "") || "research";
}

function collectMapEntityIds(mapState: MapEntityIdState) {
  return new Set([
    ...mapState.zones.map((zone) => zone.id),
    ...mapState.corridors.map((corridor) => corridor.id),
    ...mapState.targets.map((target) => target.id),
  ]);
}

function getDuplicateIdExclusion(id: string, label: string): ResearchExclusion {
  return {
    label,
    reason: "duplicate",
    caveats: [`A map entity with id "${id}" already exists or was already included.`],
  };
}

function createTargetAddressOrQueryKey(candidate: ResearchedTargetCandidate) {
  return normalizeResearchText(candidate.address ?? candidate.geocodeQuery);
}

function hasNearbyTargetWithSameName({
  targetLocations,
  candidateName,
  coordinates,
  duplicateDistanceMeters,
}: {
  targetLocations: Array<{ label: string; nameKey: string; coordinates: Coordinate }>;
  candidateName: string;
  coordinates: Coordinate;
  duplicateDistanceMeters: number;
}) {
  const candidateNameKey = normalizeResearchText(candidateName);

  return targetLocations.some(
    (targetLocation) =>
      targetLocation.nameKey === candidateNameKey &&
      distanceMeters(targetLocation.coordinates, coordinates) <= duplicateDistanceMeters,
  );
}

function collectCorridorSourceKeys(candidate: ResearchedCorridorCandidate) {
  const sourceKeys = [canonicalizeResearchSourceUrl(candidate.source.url)];

  if (candidate.geometry.kind === "sourceUrl") {
    sourceKeys.push(canonicalizeResearchSourceUrl(candidate.geometry.url));
  }

  return sourceKeys;
}

function coordinatesMatchInOrder(
  left: Coordinate[],
  right: Coordinate[],
  pointDistanceMeters: number,
) {
  return left.every(
    (leftCoordinate, index) => distanceMeters(leftCoordinate, right[index]) <= pointDistanceMeters,
  );
}

function endpointsMatchWithinDistance(
  left: Coordinate[],
  right: Coordinate[],
  pointDistanceMeters: number,
) {
  const leftStart = left[0];
  const leftEnd = left[left.length - 1];
  const rightStart = right[0];
  const rightEnd = right[right.length - 1];

  return (
    Boolean(leftStart && leftEnd && rightStart && rightEnd) &&
    distanceMeters(leftStart, rightStart) <= pointDistanceMeters &&
    distanceMeters(leftEnd, rightEnd) <= pointDistanceMeters
  );
}

function maxNearestPointDistance(fromCoordinates: Coordinate[], toCoordinates: Coordinate[]) {
  let maxDistance = 0;

  for (const fromCoordinate of fromCoordinates) {
    const nearestDistance = Math.min(
      ...toCoordinates.map((toCoordinate) => distanceMeters(fromCoordinate, toCoordinate)),
    );
    maxDistance = Math.max(maxDistance, nearestDistance);
  }

  return maxDistance;
}

function distanceMeters(left: Coordinate, right: Coordinate) {
  const leftLat = toRadians(left[1]);
  const rightLat = toRadians(right[1]);
  const deltaLat = toRadians(right[1] - left[1]);
  const deltaLng = toRadians(right[0] - left[0]);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const haversine =
    sinLat * sinLat + Math.cos(leftLat) * Math.cos(rightLat) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
