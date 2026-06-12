import { mapStateSchema } from "@/lib/domain/schemas";
import type { MapState, Priority } from "@/lib/domain/types";
import { canonicalizeGeocodeQuery } from "@/lib/geocode/canonicalize";
import {
  isTargetInfluence,
  isTargetRadiusMinutes,
} from "@/lib/map/target-points";

export { canonicalizeGeocodeQuery as canonicalizeGeocodeCacheQuery } from "@/lib/geocode/canonicalize";

const mapStateStorageKey = "sf-apt-hunt:map-state:v1";
const geocodeCacheStorageKey = "sf-apt-hunt:geocode-cache:v1";
const MAX_GEOCODE_CACHE_ENTRIES = 500;

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

function migrateStoredMapState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.targets)) {
    return value;
  }

  return {
    ...state,
    targets: state.targets.map(migrateStoredTarget),
  };
}

function migrateStoredTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const target = value as Record<string, unknown>;
  const name = typeof target.name === "string" ? target.name : "";
  const purpose = typeof target.purpose === "string" && target.purpose.trim()
    ? target.purpose
    : name;
  const priority = isPriority(target.priority) ? target.priority : "medium";

  return {
    ...target,
    purpose,
    priority,
    influence: isTargetInfluence(target.influence) ? target.influence : "positive",
    radiusMinutes: isTargetRadiusMinutes(target.radiusMinutes) ? target.radiusMinutes : 10,
  };
}

function isPriority(value: unknown): value is Priority {
  return value === "high" || value === "medium" || value === "low";
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
  const result = mapStateSchema.safeParse(migrateStoredMapState(parsedState));
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
  const canonicalQuery = canonicalizeGeocodeQuery(query);
  // Re-insert so the freshly written query is treated as the most recent entry
  // (object key order is insertion order), then drop the oldest over the cap.
  delete cache[canonicalQuery];
  cache[canonicalQuery] = entry;
  safeSetItem(localStorage, geocodeCacheStorageKey, JSON.stringify(capGeocodeCache(cache)));
}

function capGeocodeCache(cache: GeocodeCache): GeocodeCache {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_GEOCODE_CACHE_ENTRIES) {
    return cache;
  }

  const keepFrom = keys.length - MAX_GEOCODE_CACHE_ENTRIES;
  const capped: GeocodeCache = {};
  for (const key of keys.slice(keepFrom)) {
    capped[key] = cache[key];
  }

  return capped;
}
