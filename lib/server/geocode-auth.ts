import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { GeocodeAuthorization } from "@/lib/domain/types";

type GeocodeAuthorizationPayload = Omit<GeocodeAuthorization, "nonce">;

type GeocodeAuthorizationCandidate = {
  id: string;
  geocodeQuery?: string | null;
};

type CreateGeocodeAuthorizationOptions = {
  secret: string;
  candidates: GeocodeAuthorizationCandidate[];
  maxAttempts: number;
  ttlSeconds: number;
};

type VerifyGeocodeAuthorizationOptions = {
  secret: string;
  nonce: string;
  candidateId: string;
  geocodeQuery: string;
};

type VerifyGeocodeAuthorizationResult =
  | { ok: true; payload: GeocodeAuthorizationPayload }
  | {
      ok: false;
      error: "malformed_nonce" | "invalid_signature" | "expired" | "query_not_allowed";
    };

export function canonicalizeGeocodeQuery(query: string) {
  const canonical = query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*)+/g, ", ")
    .replace(/^,\s*|\s*,\s*$/g, "")
    .trim();

  if (/\bsan\s+francisco\b|\bsf\b/.test(canonical)) {
    return canonical;
  }

  return canonical.length > 0 ? `${canonical}, san francisco ca` : "san francisco ca";
}

export function hashCanonicalGeocodeQuery(query: string) {
  return createHash("sha256").update(canonicalizeGeocodeQuery(query)).digest("hex");
}

export function createGeocodeAuthorization({
  secret,
  candidates,
  maxAttempts,
  ttlSeconds,
}: CreateGeocodeAuthorizationOptions): GeocodeAuthorization {
  const payload: GeocodeAuthorizationPayload = {
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    maxAttempts,
    allowedQueries: candidates.flatMap((candidate) => {
      if (!candidate.geocodeQuery) {
        return [];
      }

      return [
        {
          candidateId: candidate.id,
          geocodeQueryHash: hashCanonicalGeocodeQuery(candidate.geocodeQuery),
        },
      ];
    }),
  };

  const encodedPayload = encodePayload(payload);

  return {
    nonce: `${encodedPayload}.${sign(encodedPayload, secret)}`,
    ...payload,
  };
}

export function verifyGeocodeAuthorization({
  secret,
  nonce,
  candidateId,
  geocodeQuery,
}: VerifyGeocodeAuthorizationOptions): VerifyGeocodeAuthorizationResult {
  const nonceParts = nonce.split(".");

  if (nonceParts.length !== 2 || !nonceParts[0] || !nonceParts[1]) {
    return { ok: false, error: "malformed_nonce" };
  }

  const [encodedPayload, signature] = nonceParts;
  const expectedSignature = sign(encodedPayload, secret);

  if (!safeStringEqual(signature, expectedSignature)) {
    return { ok: false, error: "invalid_signature" };
  }

  const payload = decodePayload(encodedPayload);

  if (!payload) {
    return { ok: false, error: "malformed_nonce" };
  }

  if (Date.now() > Date.parse(payload.expiresAt)) {
    return { ok: false, error: "expired" };
  }

  const geocodeQueryHash = hashCanonicalGeocodeQuery(geocodeQuery);
  const allowed = payload.allowedQueries.some(
    (allowedQuery) =>
      allowedQuery.candidateId === candidateId &&
      allowedQuery.geocodeQueryHash === geocodeQueryHash,
  );

  if (!allowed) {
    return { ok: false, error: "query_not_allowed" };
  }

  return { ok: true, payload };
}

function encodePayload(payload: GeocodeAuthorizationPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): GeocodeAuthorizationPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

    return isGeocodeAuthorizationPayload(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isGeocodeAuthorizationPayload(value: unknown): value is GeocodeAuthorizationPayload {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<GeocodeAuthorizationPayload>;

  return (
    typeof payload.expiresAt === "string" &&
    Number.isFinite(Date.parse(payload.expiresAt)) &&
    typeof payload.maxAttempts === "number" &&
    Number.isInteger(payload.maxAttempts) &&
    payload.maxAttempts > 0 &&
    Array.isArray(payload.allowedQueries) &&
    payload.allowedQueries.every(
      (allowedQuery) =>
        allowedQuery !== null &&
        typeof allowedQuery === "object" &&
        typeof allowedQuery.candidateId === "string" &&
        typeof allowedQuery.geocodeQueryHash === "string",
    )
  );
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeStringEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer)
  );
}
