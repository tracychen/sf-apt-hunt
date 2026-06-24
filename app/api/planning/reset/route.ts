import { z } from "zod";

import { planningResetRequestSchema } from "@/lib/domain/schemas";
import { getCurrentUserId } from "@/lib/server/auth/session";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { getPlanningStore, getPlanningStoreForWorkspace } from "@/lib/server/planning/store";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { redactSecrets } from "@/lib/server/redaction";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_RESET_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const installationSecret = request.headers.get("x-sf-apt-installation-secret");
  const userId = await getCurrentUserId(request);

  if (!userId && !installationSecret) {
    return Response.json({ ok: false, error: "Installation secret required." }, { status: 401 });
  }

  try {
    if (userId) {
      assertSameOriginRequest(request);
    }

    const body = planningResetRequestSchema.parse(
      await readJsonRequestBody(request, MAX_RESET_REQUEST_BYTES),
    );
    const workspace = userId ? (await getOrCreateDefaultWorkspace(userId)).workspace : null;

    const result = await (workspace
      ? getPlanningStoreForWorkspace(workspace.id).resetInstallation({
          clientInstallationId: workspace.id,
          clientInstallationSecretHash: `workspace:${workspace.id}`,
        })
      : getPlanningStore().resetInstallation({
          clientInstallationId: body.clientInstallationId,
          clientInstallationSecretHash: await hashInstallationSecret(installationSecret ?? ""),
        }));

    if (!result.ok && result.error !== "installation_not_found") {
      return Response.json(
        {
          ok: false,
          error: workspace
            ? "Planning reset is not owned by this workspace."
            : "Planning reset is not owned by this installation.",
        },
        { status: 403 },
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Planning reset request is too large." },
        { status: 413 },
      );
    }

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          ok: false,
          error: "Invalid planning reset request.",
          details: redactSecrets(error.issues),
        },
        { status: 400 },
      );
    }

    console.error("[api/planning/reset] planning reset failed", {
      error: redactSecrets(getErrorDetails(error)),
    });

    return Response.json(
      {
        ok: false,
        error: "Planning reset failed.",
        details: redactSecrets(error),
      },
      { status: 500 },
    );
  }
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
