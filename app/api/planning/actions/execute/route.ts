import { executePlanningActionRequestSchema } from "@/lib/domain/schemas";
import { getCurrentUserId } from "@/lib/server/auth/session";
import {
  executePlanningAction,
  toPlanningActionErrorResponse,
} from "@/lib/server/planning/actions";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { getPlanningStore, getPlanningStoreForWorkspace } from "@/lib/server/planning/store";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_EXECUTE_ACTION_REQUEST_BYTES = 256 * 1024;

export async function POST(request: Request) {
  try {
    const owner = await resolvePlanningActionOwner(request);

    if (!owner) {
      return Response.json(
        { ok: false, error: "Installation secret required." },
        { status: 401 },
      );
    }

    if (owner.kind === "workspace") {
      assertSameOriginRequest(request);
    }

    const body = executePlanningActionRequestSchema.parse(
      await readJsonRequestBody(request, MAX_EXECUTE_ACTION_REQUEST_BYTES),
    );
    const store =
      owner.kind === "workspace"
        ? getPlanningStoreForWorkspace(owner.workspace.id)
        : getPlanningStore();
    const ownsThread = await store.verifyThreadOwnership(
      body.threadId,
      owner.kind === "workspace"
        ? `workspace:${owner.workspace.id}`
        : await hashInstallationSecret(owner.installationSecret),
    );

    if (!ownsThread) {
      return Response.json(
        {
          ok: false,
          error: owner.kind === "workspace"
            ? "Planning action is not owned by this workspace."
            : "Planning action is not owned by this installation.",
        },
        { status: 403 },
      );
    }

    const result = await executePlanningAction({
      store,
      request: body,
      now: new Date().toISOString(),
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Planning action request is too large." },
        { status: 413 },
      );
    }

    return toPlanningActionErrorResponse(error);
  }
}

async function resolvePlanningActionOwner(request: Request) {
  const userId = await getCurrentUserId(request);

  if (userId) {
    return {
      kind: "workspace" as const,
      workspace: (await getOrCreateDefaultWorkspace(userId)).workspace,
    };
  }

  const installationSecret = request.headers.get("x-sf-apt-installation-secret")?.trim();

  if (!installationSecret) {
    return null;
  }

  return {
    kind: "installation" as const,
    installationSecret,
  };
}
