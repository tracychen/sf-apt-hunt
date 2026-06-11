import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/geocode/listing/route";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";
import { geocodeListingLocation } from "@/lib/server/google-geocode";
import { checkFixedWindowRateLimit, createRedisFromEnv } from "@/lib/server/rate-limit";

vi.mock("@/lib/server/google-geocode", () => ({
  geocodeListingLocation: vi.fn(),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkFixedWindowRateLimit: vi.fn(),
  createRedisFromEnv: vi.fn(),
}));

const geocodeListingLocationMock = vi.mocked(geocodeListingLocation);
const checkFixedWindowRateLimitMock = vi.mocked(checkFixedWindowRateLimit);
const createRedisFromEnvMock = vi.mocked(createRedisFromEnv);

beforeEach(() => {
  checkFixedWindowRateLimitMock.mockReset();
  createRedisFromEnvMock.mockReset();
  geocodeListingLocationMock.mockReset();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/geocode/listing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
      "x-sf-apt-session": "session-1",
    },
    body: JSON.stringify(body),
  });
}

function createNonce(query: string) {
  return createGeocodeAuthorization({
    secret: "test-secret",
    candidates: [{ id: "listing-1", geocodeQuery: query }],
    maxAttempts: 1,
    ttlSeconds: 300,
  }).nonce;
}

describe("POST /api/geocode/listing", () => {
  it("rejects missing Redis rate-limit config in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    const response = await POST(
      makeRequest({
        nonce: createNonce("Fillmore and California"),
        candidateId: "listing-1",
        geocodeQuery: "Fillmore and California",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Rate limiting is not configured.",
    });
    expect(response.status).toBe(503);
    expect(geocodeListingLocationMock).not.toHaveBeenCalled();
  });

  it("rejects tampered geocode queries with a nonce generated from a different query", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    const response = await POST(
      makeRequest({
        nonce: createNonce("Fillmore and California"),
        candidateId: "listing-1",
        geocodeQuery: "1 Infinite Loop Cupertino CA",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "query_not_allowed",
    });
    expect(response.status).toBe(403);
    expect(geocodeListingLocationMock).not.toHaveBeenCalled();
  });

  it("calls geocoding for an authorized request in development without Redis", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    geocodeListingLocationMock.mockResolvedValue({
      status: "ok",
      coordinates: [-122.433, 37.789],
      markerPrecision: "exact",
      formattedAddress: "Fillmore St & California St, San Francisco, CA 94115, USA",
    });

    const response = await POST(
      makeRequest({
        nonce: createNonce("Fillmore and California"),
        candidateId: "listing-1",
        geocodeQuery: "Fillmore and California",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      geocode: {
        status: "ok",
        coordinates: [-122.433, 37.789],
        markerPrecision: "exact",
        formattedAddress: "Fillmore St & California St, San Francisco, CA 94115, USA",
      },
    });
    expect(response.status).toBe(200);
    expect(geocodeListingLocationMock).toHaveBeenCalledWith({
      apiKey: "google-key",
      query: "Fillmore and California",
    });
  });

  it("checks separate IP, session, and nonce attempt rate limits", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    const redis = {} as ReturnType<typeof createRedisFromEnv>;
    createRedisFromEnvMock.mockReturnValue(redis);
    checkFixedWindowRateLimitMock.mockResolvedValue({
      ok: true,
      remaining: 19,
      resetAt: new Date("2026-06-11T20:00:00.000Z"),
    });
    geocodeListingLocationMock.mockResolvedValue({
      status: "ok",
      coordinates: [-122.433, 37.789],
      markerPrecision: "exact",
      formattedAddress: "Fillmore St & California St, San Francisco, CA 94115, USA",
    });

    const response = await POST(
      makeRequest({
        nonce: createNonce("Fillmore and California"),
        candidateId: "listing-1",
        geocodeQuery: "Fillmore and California",
      }),
    );

    expect(response.status).toBe(200);
    expect(checkFixedWindowRateLimitMock).toHaveBeenCalledTimes(3);
    expect(checkFixedWindowRateLimitMock.mock.calls.map(([options]) => options.key)).toEqual([
      expect.stringMatching(/^geocode:listing:ip:/),
      expect.stringMatching(/^geocode:listing:session:/),
      expect.stringMatching(/^geocode:listing:nonce:/),
    ]);
  });

  it("enforces the nonce maxAttempts counter before geocoding", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "test-secret");
    const redis = {} as ReturnType<typeof createRedisFromEnv>;
    createRedisFromEnvMock.mockReturnValue(redis);
    checkFixedWindowRateLimitMock
      .mockResolvedValueOnce({
        ok: true,
        remaining: 19,
        resetAt: new Date("2026-06-11T20:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        ok: true,
        remaining: 19,
        resetAt: new Date("2026-06-11T20:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        ok: false,
        remaining: 0,
        resetAt: new Date("2026-06-11T19:05:00.000Z"),
      });

    const response = await POST(
      makeRequest({
        nonce: createNonce("Fillmore and California"),
        candidateId: "listing-1",
        geocodeQuery: "Fillmore and California",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Geocoding rate limit exceeded.",
    });
    expect(response.status).toBe(429);
    expect(checkFixedWindowRateLimitMock.mock.calls[2]?.[0]).toMatchObject({
      key: expect.stringMatching(/^geocode:listing:nonce:/),
      limit: 1,
    });
    expect(geocodeListingLocationMock).not.toHaveBeenCalled();
  });
});
    createRedisFromEnvMock.mockReturnValue(null);

    createRedisFromEnvMock.mockReturnValue(null);

    createRedisFromEnvMock.mockReturnValue(null);
