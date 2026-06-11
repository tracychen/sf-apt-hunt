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
      const rateLimit = await checkFixedWindowRateLimit({
        redis,
        key: getRateLimitKey(request),
        limit: GEOCODE_RATE_LIMIT,
        windowSeconds: GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
      });

      if (!rateLimit.ok) {
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

function getRateLimitKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown-ip";
  const session = request.headers.get("x-sf-apt-session") ?? "unknown-session";
  const ip = forwardedFor.split(",")[0]?.trim() || "unknown-ip";
  const identityHash = createHash("sha256")
    .update(ip)
    .update("\0")
    .update(session)
    .digest("hex");

  return `geocode:listing:${identityHash}`;
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
