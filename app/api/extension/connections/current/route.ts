import { UnauthorizedError, requireCurrentUser } from "@/lib/server/auth/session";
import { revokeWorkspaceExtensionConnections } from "@/lib/server/extension/connections";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const user = await requireCurrentUser(request);
    const { workspace } = await getOrCreateDefaultWorkspace(user.id);

    await revokeWorkspaceExtensionConnections({
      userId: user.id,
      workspaceId: workspace.id,
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    console.error("[extension-connections-current-route]", error);
    return Response.json({ ok: false, error: "invalid_request" }, { status: 500 });
  }
}
