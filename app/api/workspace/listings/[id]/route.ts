import { z } from "zod";

import { patchListingRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { updateWorkspaceListingStatus } from "@/lib/server/listing-leads-db";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_PATCH_LISTING_REQUEST_BYTES = 16 * 1024;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = patchListingRequestSchema.parse(
      await readJsonRequestBody(request, MAX_PATCH_LISTING_REQUEST_BYTES),
    );
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const { id } = await context.params;
    const result = await updateWorkspaceListingStatus({
      workspaceId: workspace.id,
      canonicalUrl: decodeURIComponent(id),
      expectedListingLedgerRevision: body.expectedListingLedgerRevision,
      status: body.status,
    });

    return Response.json(result, { status: getPatchListingStatusCode(result) });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Listing update request is too large." }, { status: 413 });
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "Invalid listing update request." }, { status: 400 });
    }

    console.error("[workspace-listing-route]", error);
    return Response.json({ ok: false, error: "Listing update failed." }, { status: 500 });
  }
}

function getPatchListingStatusCode(
  result:
    | Awaited<ReturnType<typeof updateWorkspaceListingStatus>>,
) {
  if (result.ok) {
    return 200;
  }

  return result.error === "stale_listing_ledger_revision" ? 409 : 404;
}
