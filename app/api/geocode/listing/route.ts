import { createHash } from "node:crypto";

import { z } from "zod";

import { geocodeListingLocation } from "@/lib/server/google-geocode";
import { verifyGeocodeAuthorization } from "@/lib/server/geocode-auth";
import { checkFixedWindowRateLimit, createRedisFromEnv } from "@/lib/server/rate-limit";
import { redactSecrets } from "@/lib/server/redaction";

const geocodeListingRequestSchema = z
  .object({
    nonce: z.string().min(1).max(4096),
    candidateId: z.string().min(1).max(128),
    geocodeQuery: z.string().min(1).max(2000),
  })
  .strict();

const GEOCODE_RATE_LIMIT = 20;
const GEOCODE_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const nonceSecret = process.env.GEOCODE_NONCE_SECRET;

    if (!apiKey || !nonceSecret) {
      return Response.json(
        { ok: false, error: "Geocoding is not configured." },
        { status: 503 },
      );
    }

    const body = geocodeListingRequestSchema.parse(await request.json());
    const verification = verifyGeocodeAuthorization({
      secret: nonceSecret,
      nonce: body.nonce,
      candidateId: body.candidateId,
      geocodeQuery: body.geocodeQuery,
    });

    if (!verification.ok) {
      return Response.json({ ok: false, error: verification.error }, { status: 403 });
    }

    const redis = createRedisFromEnv();

    if (!redis) {
      if (process.env.NODE_ENV === "production") {
        return Response.json(
          { ok: false, error: "Rate limiting is not configured." },
          { status: 503 },
        );
      }
    } else {
      const rateLimitChecks = [
        {
          key: getIpRateLimitKey(request),
          limit: GEOCODE_RATE_LIMIT,
          windowSeconds: GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
        },
        {
          key: getSessionRateLimitKey(request),
          limit: GEOCODE_RATE_LIMIT,
          windowSeconds: GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
        },
        {
          key: getNonceAttemptLimitKey(body.nonce),
          limit: verification.payload.maxAttempts,
          windowSeconds: getNonceWindowSeconds(verification.payload.expiresAt),
        },
      ];
      const rateLimitResults = await Promise.all(
        rateLimitChecks.map((rateLimitCheck) =>
          checkFixedWindowRateLimit({ redis, ...rateLimitCheck }),
        ),
      );

      if (rateLimitResults.some((rateLimit) => !rateLimit.ok)) {
        return Response.json(
          { ok: false, error: "Geocoding rate limit exceeded." },
          { status: 429 },
        );
      }
    }

    const geocode = await geocodeListingLocation({
      apiKey,
      query: body.geocodeQuery,
    });

    if (geocode.status !== "ok") {
      return Response.json(
        { ok: false, status: geocode.status, error: geocode.error },
        { status: 400 },
      );
    }

    return Response.json({ ok: true, geocode });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "Invalid geocode request.",
        details: redactSecrets(getErrorDetails(error)),
      },
      { status: 400 },
    );
  }
}

function getIpRateLimitKey(request: Request) {
  return `geocode:listing:ip:${hashValue(getClientIp(request))}`;
}

function getSessionRateLimitKey(request: Request) {
  return `geocode:listing:session:${hashValue(getClientSession(request))}`;
}

function getNonceAttemptLimitKey(nonce: string) {
  return `geocode:listing:nonce:${hashValue(nonce)}`;
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown-ip";
  return forwardedFor.split(",")[0]?.trim() || "unknown-ip";
}

function getClientSession(request: Request) {
  return request.headers.get("x-sf-apt-session")?.trim() || "unknown-session";
}

function getNonceWindowSeconds(expiresAt: string) {
  const expiresInMs = Date.parse(expiresAt) - Date.now();
  return Math.max(1, Math.ceil(expiresInMs / 1000));
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function getErrorDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return error;
}
