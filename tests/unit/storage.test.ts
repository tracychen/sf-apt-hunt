import { describe, expect, it } from "vitest";

import type { MapState } from "@/lib/domain/types";
import {
  clearStoredOpenAiKey,
  loadStoredOpenAiKey,
  saveOpenAiKey,
} from "@/lib/storage/api-key-storage";
import {
  canonicalizeGeocodeCacheQuery,
  clearMapState,
  loadGeocodeCache,
  loadMapState,
  saveGeocodeCacheEntry,
  saveMapState,
} from "@/lib/storage/map-storage";

const apiKeyStorageKey = "sf-apt-hunt:openai-key";
const mapStateStorageKey = "sf-apt-hunt:map-state:v1";
const geocodeCacheStorageKey = "sf-apt-hunt:geocode-cache:v1";

class FakeStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("storage unavailable");
  }

  clear(): void {
    throw new Error("storage unavailable");
  }

  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  key(): string | null {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

function createBrowserStorage() {
  return {
    localStorage: new FakeStorage(),
    sessionStorage: new FakeStorage(),
  };
}

const validMapState: MapState = {
  zones: [
    {
      id: "mission-dolores",
      name: "Mission Dolores",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.43, 37.77],
            [-122.42, 37.77],
            [-122.42, 37.76],
            [-122.43, 37.76],
            [-122.43, 37.77],
          ],
        ],
      },
      fitnessScore: 5,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Close to transit and gyms."],
    },
  ],
  corridors: [
    {
      id: "valencia",
      name: "Valencia",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.421, 37.752],
          [-122.421, 37.769],
        ],
      },
      priority: "high",
      tags: ["fitness", "transit"],
      notes: [],
    },
  ],
  targets: [
    {
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "favorite block",
      coordinates: [-122.433, 37.789],
      priority: "medium",
      influence: "positive",
      radiusMinutes: 10,
      notes: [],
    },
  ],
};

describe("api key storage", () => {
  it("uses sessionStorage by default", () => {
    const storage = createBrowserStorage();

    saveOpenAiKey("sk-session", false, storage);

    expect(storage.sessionStorage.getItem(apiKeyStorageKey)).toBe("sk-session");
    expect(storage.localStorage.getItem(apiKeyStorageKey)).toBeNull();
    expect(loadStoredOpenAiKey(storage)).toEqual({
      key: "sk-session",
      remembered: false,
    });
  });

  it("uses localStorage only when remember=true", () => {
    const storage = createBrowserStorage();
    storage.sessionStorage.setItem(apiKeyStorageKey, "old-session");

    saveOpenAiKey("sk-remembered", true, storage);

    expect(storage.localStorage.getItem(apiKeyStorageKey)).toBe("sk-remembered");
    expect(storage.sessionStorage.getItem(apiKeyStorageKey)).toBeNull();
    expect(loadStoredOpenAiKey(storage)).toEqual({
      key: "sk-remembered",
      remembered: true,
    });
  });

  it("clearing API key clears both stores", () => {
    const storage = createBrowserStorage();
    storage.localStorage.setItem(apiKeyStorageKey, "remembered");
    storage.sessionStorage.setItem(apiKeyStorageKey, "session");

    clearStoredOpenAiKey(storage);

    expect(storage.localStorage.getItem(apiKeyStorageKey)).toBeNull();
    expect(storage.sessionStorage.getItem(apiKeyStorageKey)).toBeNull();
    expect(loadStoredOpenAiKey(storage)).toEqual({
      key: null,
      remembered: false,
    });
  });

  it("does not throw without browser storage", () => {
    expect(() => saveOpenAiKey("sk-session", false)).not.toThrow();
    expect(() => saveOpenAiKey("sk-remembered", true)).not.toThrow();
    expect(loadStoredOpenAiKey()).toEqual({
      key: null,
      remembered: false,
    });
    expect(() => clearStoredOpenAiKey()).not.toThrow();
  });

  it("fails closed when storage methods throw", () => {
    const storage = {
      localStorage: new ThrowingStorage(),
      sessionStorage: new ThrowingStorage(),
    };

    expect(() => saveOpenAiKey("sk-session", false, storage)).not.toThrow();
    expect(() => saveOpenAiKey("sk-remembered", true, storage)).not.toThrow();
    expect(loadStoredOpenAiKey(storage)).toEqual({
      key: null,
      remembered: false,
    });
    expect(() => clearStoredOpenAiKey(storage)).not.toThrow();
  });
});

describe("map storage", () => {
  it("saves and loads map state from localStorage", () => {
    const localStorage = new FakeStorage();

    saveMapState(validMapState, localStorage);

    expect(localStorage.getItem(mapStateStorageKey)).toBe(JSON.stringify(validMapState));
    expect(loadMapState(localStorage)).toEqual({
      ...validMapState,
      areas: [],
    });
  });

  it("clears map state", () => {
    const localStorage = new FakeStorage();
    localStorage.setItem(mapStateStorageKey, JSON.stringify(validMapState));

    clearMapState(localStorage);

    expect(localStorage.getItem(mapStateStorageKey)).toBeNull();
    expect(loadMapState(localStorage)).toBeNull();
  });

  it("returns null for malformed map JSON", () => {
    const localStorage = new FakeStorage();
    localStorage.setItem(mapStateStorageKey, "{");

    expect(loadMapState(localStorage)).toBeNull();
  });

  it("returns null for schema-invalid map state", () => {
    const localStorage = new FakeStorage();
    localStorage.setItem(
      mapStateStorageKey,
      JSON.stringify({
        zones: [],
        corridors: [],
      }),
    );

    expect(loadMapState(localStorage)).toBeNull();
  });

  it("migrates legacy target points when loading stored map state", () => {
    const localStorage = new FakeStorage();
    const legacyState = {
      ...validMapState,
      targets: [
        {
          id: "fillmore-california",
          name: "Fillmore & California",
          coordinates: [-122.433, 37.789],
          priority: "medium",
          notes: [],
        },
      ],
    };
    localStorage.setItem(mapStateStorageKey, JSON.stringify(legacyState));

    expect(loadMapState(localStorage)?.targets[0]).toEqual({
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "Fillmore & California",
      coordinates: [-122.433, 37.789],
      priority: "medium",
      influence: "positive",
      radiusMinutes: 10,
      notes: [],
    });
  });

  it("stores geocode cache entries by normalized query", () => {
    const localStorage = new FakeStorage();

    saveGeocodeCacheEntry(
      "  Fillmore   St AND California St, San Francisco, CA  ",
      {
        coordinates: [-122.433, 37.789],
        markerPrecision: "exact",
      },
      localStorage,
    );

    expect(loadGeocodeCache(localStorage)).toEqual({
      "fillmore st and california st, san francisco ca": {
        coordinates: [-122.433, 37.789],
        markerPrecision: "exact",
      },
    });
    expect(localStorage.getItem(geocodeCacheStorageKey)).toBe(
      JSON.stringify({
        "fillmore st and california st, san francisco ca": {
          coordinates: [-122.433, 37.789],
          markerPrecision: "exact",
        },
      }),
    );
  });

  it("stores equivalent geocode queries with and without San Francisco suffix under one cache key", () => {
    const localStorage = new FakeStorage();

    saveGeocodeCacheEntry(
      "Fillmore and California",
      {
        coordinates: [-122.433, 37.789],
        markerPrecision: "exact",
      },
      localStorage,
    );
    saveGeocodeCacheEntry(
      "Fillmore and California, San Francisco CA",
      {
        coordinates: [-122.434, 37.79],
        markerPrecision: "approximate",
      },
      localStorage,
    );

    expect(loadGeocodeCache(localStorage)).toEqual({
      "fillmore and california, san francisco ca": {
        coordinates: [-122.434, 37.79],
        markerPrecision: "approximate",
      },
    });
  });

  it("stores failed geocode cache entries by normalized query", () => {
    const localStorage = new FakeStorage();

    saveGeocodeCacheEntry(
      "  No   Such Listing, San Francisco, CA  ",
      {
        status: "failed",
        error: "No geocode result found.",
      },
      localStorage,
    );

    expect(loadGeocodeCache(localStorage)).toEqual({
      "no such listing, san francisco ca": {
        status: "failed",
        error: "No geocode result found.",
      },
    });
    expect(localStorage.getItem(geocodeCacheStorageKey)).toBe(
      JSON.stringify({
        "no such listing, san francisco ca": {
          status: "failed",
          error: "No geocode result found.",
        },
      }),
    );
  });

  it("drops invalid geocode cache entries when loading", () => {
    const localStorage = new FakeStorage();
    localStorage.setItem(
      geocodeCacheStorageKey,
      `{
        "valid query": {
          "coordinates": [-122.433, 37.789],
          "markerPrecision": "approximate"
        },
        "infinite query": {
          "coordinates": [1e999, 37.789],
          "markerPrecision": "exact"
        },
        "wrong marker precision": {
          "coordinates": [-122.433, 37.789],
          "markerPrecision": "none"
        },
        "wrong failed status": {
          "status": "not_attempted",
          "error": "Invalid cache entry."
        }
      }`,
    );

    expect(loadGeocodeCache(localStorage)).toEqual({
      "valid query": {
        coordinates: [-122.433, 37.789],
        markerPrecision: "approximate",
      },
    });
  });

  it("evicts the oldest geocode cache entries beyond the size cap", () => {
    const localStorage = new FakeStorage();
    const total = 520;

    for (let index = 0; index < total; index += 1) {
      saveGeocodeCacheEntry(
        `Query number ${index}`,
        { coordinates: [-122.4 - index * 0.0001, 37.7], markerPrecision: "exact" },
        localStorage,
      );
    }

    const cache = loadGeocodeCache(localStorage);

    expect(Object.keys(cache)).toHaveLength(500);
    expect(cache[canonicalizeGeocodeCacheQuery("Query number 0")]).toBeUndefined();
    expect(cache[canonicalizeGeocodeCacheQuery("Query number 19")]).toBeUndefined();
    expect(cache[canonicalizeGeocodeCacheQuery("Query number 20")]).toBeDefined();
    expect(cache[canonicalizeGeocodeCacheQuery("Query number 519")]).toBeDefined();
  });

  it("keeps a re-saved query as the most recent entry", () => {
    const localStorage = new FakeStorage();

    for (let index = 0; index < 500; index += 1) {
      saveGeocodeCacheEntry(
        `Query number ${index}`,
        { coordinates: [-122.4 - index * 0.0001, 37.7], markerPrecision: "exact" },
        localStorage,
      );
    }

    // Re-touch the oldest entry so it becomes most-recent, then push one more.
    saveGeocodeCacheEntry(
      "Query number 0",
      { coordinates: [-122.4, 37.7], markerPrecision: "approximate" },
      localStorage,
    );
    saveGeocodeCacheEntry(
      "Query number 500",
      { coordinates: [-122.5, 37.7], markerPrecision: "exact" },
      localStorage,
    );

    const cache = loadGeocodeCache(localStorage);

    expect(Object.keys(cache)).toHaveLength(500);
    expect(cache[canonicalizeGeocodeCacheQuery("Query number 0")]).toEqual({
      coordinates: [-122.4, 37.7],
      markerPrecision: "approximate",
    });
    expect(cache[canonicalizeGeocodeCacheQuery("Query number 1")]).toBeUndefined();
  });

  it("does not throw without browser storage", () => {
    expect(() => saveMapState(validMapState)).not.toThrow();
    expect(loadMapState()).toBeNull();
    expect(() => clearMapState()).not.toThrow();
    expect(loadGeocodeCache()).toEqual({});
    expect(() =>
      saveGeocodeCacheEntry("Fillmore and California, San Francisco, CA", {
        coordinates: [-122.433, 37.789],
        markerPrecision: "exact",
      }),
    ).not.toThrow();
  });

  it("fails closed when storage methods throw", () => {
    const localStorage = new ThrowingStorage();

    expect(() => saveMapState(validMapState, localStorage)).not.toThrow();
    expect(loadMapState(localStorage)).toBeNull();
    expect(() => clearMapState(localStorage)).not.toThrow();
    expect(loadGeocodeCache(localStorage)).toEqual({});
    expect(() =>
      saveGeocodeCacheEntry(
        "Fillmore and California, San Francisco, CA",
        {
          coordinates: [-122.433, 37.789],
          markerPrecision: "exact",
        },
        localStorage,
      ),
    ).not.toThrow();
  });
});
