import { z } from "zod";

import { postGeocodeCacheRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { upsertWorkspaceGeocodeResult } from "@/lib/server/listing-leads-db";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_GEOCODE_CACHE_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = postGeocodeCacheRequestSchema.parse(
      await readJsonRequestBody(request, MAX_GEOCODE_CACHE_REQUEST_BYTES),
    );
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const result = await upsertWorkspaceGeocodeResult({
      workspaceId: workspace.id,
      canonicalUrl: body.canonicalUrl,
      expectedListingLedgerRevision: body.expectedListingLedgerRevision,
      queryHash: body.queryHash,
      query: body.query,
      result: body.result,
    });

    return Response.json(result, { status: getGeocodeCacheStatusCode(result) });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Geocode cache request is too large." }, { status: 413 });
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "Invalid geocode cache request." }, { status: 400 });
    }

    console.error("[workspace-geocode-cache-route]", error);
    return Response.json({ ok: false, error: "Geocode cache update failed." }, { status: 500 });
  }
}

function getGeocodeCacheStatusCode(
  result: Awaited<ReturnType<typeof upsertWorkspaceGeocodeResult>>,
) {
  if (result.ok) {
    return 200;
  }

  return result.error === "stale_listing_ledger_revision" ? 409 : 404;
}
