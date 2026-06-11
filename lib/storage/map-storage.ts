import { mapStateSchema } from "@/lib/domain/schemas";
import type { MapState } from "@/lib/domain/types";

const mapStateStorageKey = "sf-apt-hunt:map-state:v1";
const geocodeCacheStorageKey = "sf-apt-hunt:geocode-cache:v1";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type GeocodeCacheEntry = {
  coordinates: [number, number];
  markerPrecision: "exact" | "approximate";
};

export type GeocodeCache = Record<string, GeocodeCacheEntry>;

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function resolveLocalStorage(storage?: StorageLike): StorageLike | null {
  return storage ?? getBrowserLocalStorage();
}

function normalizeGeocodeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isGeocodeCacheEntry(value: unknown): value is GeocodeCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<GeocodeCacheEntry>;
  return (
    Array.isArray(entry.coordinates) &&
    entry.coordinates.length === 2 &&
    entry.coordinates.every((coordinate) => typeof coordinate === "number") &&
    (entry.markerPrecision === "exact" || entry.markerPrecision === "approximate")
  );
}

function isGeocodeCache(value: unknown): value is GeocodeCache {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(isGeocodeCacheEntry)
  );
}

export function saveMapState(state: MapState, storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  localStorage.setItem(mapStateStorageKey, JSON.stringify(state));
}

export function loadMapState(storage?: StorageLike): MapState | null {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return null;
  }

  const rawState = localStorage.getItem(mapStateStorageKey);
  if (rawState === null) {
    return null;
  }

  const parsedState = parseJson(rawState);
  const result = mapStateSchema.safeParse(parsedState);
  return result.success ? result.data : null;
}

export function clearMapState(storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  localStorage.removeItem(mapStateStorageKey);
}

export function loadGeocodeCache(storage?: StorageLike): GeocodeCache {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return {};
  }

  const rawCache = localStorage.getItem(geocodeCacheStorageKey);
  if (rawCache === null) {
    return {};
  }

  const parsedCache = parseJson(rawCache);
  return isGeocodeCache(parsedCache) ? parsedCache : {};
}

export function saveGeocodeCacheEntry(
  query: string,
  entry: GeocodeCacheEntry,
  storage?: StorageLike,
) {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  const cache = loadGeocodeCache(localStorage);
  cache[normalizeGeocodeQuery(query)] = entry;
  localStorage.setItem(geocodeCacheStorageKey, JSON.stringify(cache));
}
