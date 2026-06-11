import { mapStateSchema } from "@/lib/domain/schemas";
import type { MapState } from "@/lib/domain/types";
import { canonicalizeGeocodeQuery } from "@/lib/geocode/canonicalize";

export { canonicalizeGeocodeQuery as canonicalizeGeocodeCacheQuery } from "@/lib/geocode/canonicalize";

const mapStateStorageKey = "sf-apt-hunt:map-state:v1";
const geocodeCacheStorageKey = "sf-apt-hunt:geocode-cache:v1";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type GeocodeCacheEntry = {
  coordinates: [number, number];
  markerPrecision: "exact" | "approximate";
} | {
  status: "failed" | "outside_sf";
  error?: string;
};

export type GeocodeCache = Record<string, GeocodeCacheEntry>;

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveLocalStorage(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? getBrowserLocalStorage();
  } catch {
    return null;
  }
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function safeGetItem(storage: StorageLike, key: string) {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeRemoveItem(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}

function safeSetItem(storage: StorageLike, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    return false;
  }

  return true;
}

function isGeocodeCacheEntry(value: unknown): value is GeocodeCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  const coordinates = entry.coordinates;
  const markerPrecision = entry.markerPrecision;
  const status = entry.status;
  const error = entry.error;

  const isSuccessfulEntry =
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    coordinates.every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
    ) &&
    (markerPrecision === "exact" || markerPrecision === "approximate");

  if (isSuccessfulEntry) {
    return true;
  }

  return (
    (status === "failed" || status === "outside_sf") &&
    (typeof error === "undefined" || typeof error === "string")
  );
}

function parseGeocodeCache(value: unknown): GeocodeCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, GeocodeCacheEntry] =>
      isGeocodeCacheEntry(entry[1]),
    ),
  );
}

function readGeocodeCache(storage: StorageLike) {
  const rawCache = safeGetItem(storage, geocodeCacheStorageKey);
  if (!rawCache.ok) {
    return { ok: false, cache: {} };
  }

  if (rawCache.value === null) {
    return { ok: true, cache: {} };
  }

  return { ok: true, cache: parseGeocodeCache(parseJson(rawCache.value)) };
}

export function saveMapState(state: MapState, storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  safeSetItem(localStorage, mapStateStorageKey, JSON.stringify(state));
}

export function loadMapState(storage?: StorageLike): MapState | null {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return null;
  }

  const rawState = safeGetItem(localStorage, mapStateStorageKey);
  if (!rawState.ok) {
    return null;
  }

  if (rawState.value === null) {
    return null;
  }

  const parsedState = parseJson(rawState.value);
  const result = mapStateSchema.safeParse(parsedState);
  return result.success ? result.data : null;
}

export function clearMapState(storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  safeRemoveItem(localStorage, mapStateStorageKey);
}

export function loadGeocodeCache(storage?: StorageLike): GeocodeCache {
  const localStorage = resolveLocalStorage(storage);

  if (!localStorage) {
    return {};
  }

  return readGeocodeCache(localStorage).cache;
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

  if (!isGeocodeCacheEntry(entry)) {
    return;
  }

  const cacheResult = readGeocodeCache(localStorage);
  if (!cacheResult.ok) {
    return;
  }

  const cache = cacheResult.cache;
  cache[canonicalizeGeocodeQuery(query)] = entry;
  safeSetItem(localStorage, geocodeCacheStorageKey, JSON.stringify(cache));
}
