import type { LineStringGeometry, PolygonGeometry } from "@/lib/domain/types";

const SF_BOUNDS = {
  minLng: -122.53,
  maxLng: -122.35,
  minLat: 37.69,
  maxLat: 37.84,
};

export function isCoordinateInSfBounds(coordinate: readonly [number, number] | number[]) {
  const [lng, lat] = coordinate;

  return (
    coordinate.length === 2 &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= SF_BOUNDS.minLng &&
    lng <= SF_BOUNDS.maxLng &&
    lat >= SF_BOUNDS.minLat &&
    lat <= SF_BOUNDS.maxLat
  );
}

export function isPolygonRingClosed(ring: Array<[number, number]>) {
  const first = ring[0];
  const last = ring[ring.length - 1];

  return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
}

function isValidPolygonRing(ring: Array<[number, number]>) {
  return ring.length >= 4 && isPolygonRingClosed(ring) && ring.every(isCoordinateInSfBounds);
}

export function isPolygonInSfBounds(geometry: PolygonGeometry) {
  return geometry.coordinates.length > 0 && geometry.coordinates.every(isValidPolygonRing);
}

export function isLineStringInSfBounds(geometry: LineStringGeometry) {
  return geometry.coordinates.every(isCoordinateInSfBounds);
}

export function closePolygonRing(ring: Array<[number, number]>) {
  const first = ring[0];
  const last = ring[ring.length - 1];

  if (!first || !last) {
    return ring;
  }

  if (isPolygonRingClosed(ring)) {
    return ring;
  }

  return [...ring, [first[0], first[1]]];
}
