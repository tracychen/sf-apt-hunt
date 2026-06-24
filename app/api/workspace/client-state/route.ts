import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { listWorkspaceListingLeads } from "@/lib/server/listing-leads-db";
import { listWorkspacePlanningThreadCache } from "@/lib/server/planning/store-db";
import {
  getOrCreateDefaultWorkspace,
  serializeWorkspaceMapSnapshot,
  serializeWorkspaceRecord,
} from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { workspace, mapSnapshot } = await getOrCreateDefaultWorkspace(userId);
    const listings = await listWorkspaceListingLeads(workspace.id);
    const planningThreadCache = await listWorkspacePlanningThreadCache({
      workspaceId: workspace.id,
      mapSnapshot,
      listingLedgerRevision: listings.listingLedgerRevision,
    });

    return Response.json({
      workspace: serializeWorkspaceRecord(workspace),
      mapSnapshot: serializeWorkspaceMapSnapshot(mapSnapshot),
      listingLeads: listings.leads,
      listingLedgerRevision: listings.listingLedgerRevision,
      planningThreadCache,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    console.error("[workspace-client-state-route]", error);
    return Response.json({ ok: false, error: "Workspace client state failed." }, { status: 500 });
  }
}
