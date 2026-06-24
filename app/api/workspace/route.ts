import { z } from "zod";

import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import {
  deleteDefaultWorkspaceForUser,
  getOrCreateDefaultWorkspace,
  serializeWorkspaceResponse,
} from "@/lib/server/workspaces";

const MAX_WORKSPACE_DELETE_REQUEST_BYTES = 16 * 1024;
const deleteWorkspaceRequestSchema = z
  .object({
    confirmation: z.literal("delete"),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    return Response.json(serializeWorkspaceResponse(await getOrCreateDefaultWorkspace(userId)));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return Response.json({ ok: false, error: "Workspace load failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    deleteWorkspaceRequestSchema.parse(
      await readJsonRequestBody(request, MAX_WORKSPACE_DELETE_REQUEST_BYTES),
    );
    await deleteDefaultWorkspaceForUser(userId);

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Workspace delete request is too large." }, { status: 413 });
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "Invalid workspace delete request." }, { status: 400 });
    }

    console.error("[workspace-route]", error);
    return Response.json({ ok: false, error: "Workspace delete failed." }, { status: 500 });
  }
}
