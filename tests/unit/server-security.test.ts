import { describe, expect, it, vi } from "vitest";

import {
  canonicalizeGeocodeQuery,
  createGeocodeAuthorization,
  verifyGeocodeAuthorization,
} from "@/lib/server/geocode-auth";
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
});

describe("geocode query authorization", () => {
  it("canonicalizes geocode queries for stable authorization", () => {
    expect(canonicalizeGeocodeQuery("  123   MAIN St ,  Apt 4  ")).toBe(
      "123 main st, apt 4, san francisco ca",
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
});
