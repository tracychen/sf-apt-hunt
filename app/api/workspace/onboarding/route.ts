import { z } from "zod";

import { putWorkspaceOnboardingRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { updateWorkspaceOnboarding } from "@/lib/server/workspace-onboarding";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_WORKSPACE_ONBOARDING_REQUEST_BYTES = 16 * 1024;

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = putWorkspaceOnboardingRequestSchema.parse(
      await readJsonRequestBody(request, MAX_WORKSPACE_ONBOARDING_REQUEST_BYTES),
    );
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const progress = await updateWorkspaceOnboarding({
      workspaceId: workspace.id,
      operation: body.operation,
    });

    return Response.json({ ok: true, progress });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "forbidden_origin" }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "request_too_large" }, { status: 413 });
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }

    console.error("[workspace-onboarding-route]", error);
    return Response.json({ ok: false, error: "onboarding_update_failed" }, { status: 500 });
  }
}
