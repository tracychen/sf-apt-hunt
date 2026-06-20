import { executePlanningActionRequestSchema } from "@/lib/domain/schemas";
import {
  executePlanningAction,
  toPlanningActionErrorResponse,
} from "@/lib/server/planning/actions";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { getPlanningStore } from "@/lib/server/planning/store";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_EXECUTE_ACTION_REQUEST_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const installationSecret = request.headers.get("x-sf-apt-installation-secret");

  if (!installationSecret) {
    return Response.json({ ok: false, error: "Installation secret required." }, { status: 401 });
  }

  try {
    const body = executePlanningActionRequestSchema.parse(
      await readJsonRequestBody(request, MAX_EXECUTE_ACTION_REQUEST_BYTES),
    );
    const store = getPlanningStore();
    const ownsThread = await store.verifyThreadOwnership(
      body.threadId,
      await hashInstallationSecret(installationSecret),
    );

    if (!ownsThread) {
      return Response.json(
        { ok: false, error: "Planning action is not owned by this installation." },
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
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Planning action request is too large." },
        { status: 413 },
      );
    }

    return toPlanningActionErrorResponse(error);
  }
}
