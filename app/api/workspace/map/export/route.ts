import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { mapSnapshot } = await getOrCreateDefaultWorkspace(userId);

    return Response.json(mapSnapshot.mapState);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    console.error("[workspace-map-export-route]", error);
    return Response.json({ ok: false, error: "Workspace export failed." }, { status: 500 });
  }
}
