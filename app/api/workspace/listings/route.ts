import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { listWorkspaceListingLeads } from "@/lib/server/listing-leads-db";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    return Response.json(await listWorkspaceListingLeads(workspace.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    console.error("[workspace-listings-route]", error);
    return Response.json({ ok: false, error: "Listing load failed." }, { status: 500 });
  }
}
