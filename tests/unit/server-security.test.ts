import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  canonicalizeGeocodeQuery,
  createGeocodeAuthorization,
  verifyGeocodeAuthorization,
} from "@/lib/server/geocode-auth";
import { checkFixedWindowRateLimit } from "@/lib/server/rate-limit";
import { redactSecrets } from "@/lib/server/redaction";

describe("server secret redaction", () => {
  it("redacts OpenAI-style keys recursively, including credential fields", () => {
    const redacted = redactSecrets({
      apiKey: "sk-direct_123",
      message: "Use sk-inline-abcDEF_123 for the request.",
      nested: {
        authorization: "Bearer sk-auth_456",
        value: ["safe", "nested sk-array_789 token"],
      },
      entries: [
        {
          openAiKey: "sk-openai-000",
          metadata: {
            token: "plain-token",
            note: "second sk-note_xyz",
          },
        },
      ],
    });

    expect(redacted).toEqual({
      apiKey: "[REDACTED]",
      message: "Use [REDACTED] for the request.",
      nested: {
        authorization: "[REDACTED]",
        value: ["safe", "nested [REDACTED] token"],
      },
      entries: [
        {
          openAiKey: "[REDACTED]",
          metadata: {
            token: "[REDACTED]",
            note: "second [REDACTED]",
          },
        },
      ],
    });
  });

  it("redacts provider URL query params, Google-style keys, and API key fields", () => {
    const redacted = redactSecrets({
      url: "https://maps.googleapis.com/maps/api/geocode/json?address=sf&key=AIzaSyA1234567890abcdefghijklmnopqrstuvwxyzAB&api_key=plain-secret",
      message: "Provider token AIzaSyB1234567890abcdefghijklmnopqrstuvwxyzCD should not leak.",
      api_key: "snake-case-secret",
      "x-api-key": "header-secret",
      googleMapsApiKey: "camel-secret",
      GOOGLE_MAPS_API_KEY: "env-secret",
    });

    expect(redacted).toEqual({
      url: "https://maps.googleapis.com/maps/api/geocode/json?address=sf&key=[REDACTED]&api_key=[REDACTED]",
      message: "Provider token [REDACTED] should not leak.",
      api_key: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      googleMapsApiKey: "[REDACTED]",
      GOOGLE_MAPS_API_KEY: "[REDACTED]",
    });
  });
});

describe("geocode query authorization", () => {
  it("canonicalizes geocode queries for stable authorization", () => {
    expect(canonicalizeGeocodeQuery("  123   MAIN St ,  Apt 4  ")).toBe(
      "123 main st, apt 4, san francisco ca",
    );
  });

  it("canonicalizes explicit San Francisco punctuation consistently", () => {
    expect(canonicalizeGeocodeQuery("Fillmore and California, San Francisco, CA")).toBe(
      canonicalizeGeocodeQuery("Fillmore and California San Francisco CA"),
    );
  });

  it("does not treat generic sf as San Francisco city context", () => {
    expect(canonicalizeGeocodeQuery("500 sf studio")).toBe(
      "500 sf studio, san francisco ca",
    );
  });

  it("accepts a signed candidate/query pair", () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const authorization = createGeocodeAuthorization({
      secret: "test-secret",
      candidates: [{ id: "listing-1", geocodeQuery: "  Fillmore   St , California St  " }],
      maxAttempts: 2,
      ttlSeconds: 60,
    });

    const verification = verifyGeocodeAuthorization({
      secret: "test-secret",
      nonce: authorization.nonce,
      candidateId: "listing-1",
      geocodeQuery: "fillmore st, california st, san francisco ca",
    });

    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.payload).toEqual({
        expiresAt: "2026-06-11T19:01:00.000Z",
        maxAttempts: 2,
        allowedQueries: authorization.allowedQueries,
      });
    }
  });

  it("rejects a tampered query for a valid candidate ID", () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const authorization = createGeocodeAuthorization({
      secret: "test-secret",
      candidates: [{ id: "listing-1", geocodeQuery: "100 Market St" }],
      maxAttempts: 1,
      ttlSeconds: 60,
    });

    const verification = verifyGeocodeAuthorization({
      secret: "test-secret",
      nonce: authorization.nonce,
      candidateId: "listing-1",
      geocodeQuery: "101 Market St",
    });

    expect(verification).toEqual({ ok: false, error: "query_not_allowed" });
  });

  it("rejects an expired nonce", () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const authorization = createGeocodeAuthorization({
      secret: "test-secret",
      candidates: [{ id: "listing-1", geocodeQuery: "100 Market St" }],
      maxAttempts: 1,
      ttlSeconds: 60,
    });

    vi.setSystemTime(new Date("2026-06-11T19:01:01.000Z"));

    const verification = verifyGeocodeAuthorization({
      secret: "test-secret",
      nonce: authorization.nonce,
      candidateId: "listing-1",
      geocodeQuery: "100 Market St",
    });

    expect(verification).toEqual({ ok: false, error: "expired" });
  });

  it("rejects a malformed nonce without throwing", () => {
    expect(() =>
      verifyGeocodeAuthorization({
        secret: "test-secret",
        nonce: "not-a-valid-nonce",
        candidateId: "listing-1",
        geocodeQuery: "100 Market St",
      }),
    ).not.toThrow();
    expect(
      verifyGeocodeAuthorization({
        secret: "test-secret",
        nonce: "not-a-valid-nonce",
        candidateId: "listing-1",
        geocodeQuery: "100 Market St",
      }),
    ).toEqual({ ok: false, error: "malformed_nonce" });
  });

  it("rejects an invalid same-length signature without throwing", () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const authorization = createGeocodeAuthorization({
      secret: "test-secret",
      candidates: [{ id: "listing-1", geocodeQuery: "100 Market St" }],
      maxAttempts: 1,
      ttlSeconds: 60,
    });
    const [payload, signature] = authorization.nonce.split(".");
    const invalidSignature = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;

    expect(invalidSignature).toHaveLength(signature.length);
    expect(() =>
      verifyGeocodeAuthorization({
        secret: "test-secret",
        nonce: `${payload}.${invalidSignature}`,
        candidateId: "listing-1",
        geocodeQuery: "100 Market St",
      }),
    ).not.toThrow();
    expect(
      verifyGeocodeAuthorization({
        secret: "test-secret",
        nonce: `${payload}.${invalidSignature}`,
        candidateId: "listing-1",
        geocodeQuery: "100 Market St",
      }),
    ).toEqual({ ok: false, error: "invalid_signature" });
  });

  it("rejects a signed nonce with malformed payload shape without throwing", () => {
    const nonce = createSignedNonce(
      {
        expiresAt: "2026-06-11T19:01:00.000Z",
        maxAttempts: 1,
        allowedQueries: [{ candidateId: "listing-1" }],
      },
      "test-secret",
    );

    expect(() =>
      verifyGeocodeAuthorization({
        secret: "test-secret",
        nonce,
        candidateId: "listing-1",
        geocodeQuery: "100 Market St",
      }),
    ).not.toThrow();
    expect(
      verifyGeocodeAuthorization({
        secret: "test-secret",
        nonce,
        candidateId: "listing-1",
        geocodeQuery: "100 Market St",
      }),
    ).toEqual({ ok: false, error: "malformed_nonce" });
  });
});

describe("fixed-window rate limit", () => {
  it("repairs missing Redis TTLs on over-limit keys", async () => {
    vi.setSystemTime(new Date("2026-06-11T19:00:00.000Z"));

    const redis = {
      incr: vi.fn().mockResolvedValue(6),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(-1),
    };

    const result = await checkFixedWindowRateLimit({
      redis: redis as unknown as Parameters<typeof checkFixedWindowRateLimit>[0]["redis"],
      key: "rate-limit:test",
      limit: 5,
      windowSeconds: 60,
    });

    expect(redis.expire).toHaveBeenCalledWith("rate-limit:test", 60);
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(Number.isFinite(result.resetAt.getTime())).toBe(true);
    expect(result.resetAt).toEqual(new Date("2026-06-11T19:01:00.000Z"));
  });
});

function createSignedNonce(payload: unknown, secret: string) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return `${encodedPayload}.${signature}`;
}
