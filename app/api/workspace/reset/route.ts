import { z } from "zod";

import { workspaceResetRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { resetWorkspace } from "@/lib/server/workspace-state";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_WORKSPACE_REQUEST_BYTES = 256 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = workspaceResetRequestSchema.parse(
      await readJsonRequestBody(request, MAX_WORKSPACE_REQUEST_BYTES),
    );
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const result = await resetWorkspace({
      workspaceId: workspace.id,
      expectedMapRevision: body.expectedMapRevision,
      expectedListingLedgerRevision: body.expectedListingLedgerRevision,
    });

    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Workspace reset request is too large." }, { status: 413 });
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "Invalid workspace reset request." }, { status: 400 });
    }

    console.error("[workspace-reset-route]", error);
    return Response.json({ ok: false, error: "Workspace reset failed." }, { status: 500 });
  }
}
