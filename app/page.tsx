import { ApartmentMapApp } from "@/components/apartment-map/apartment-map-app";
import { PersistentApartmentMapApp } from "@/components/apartment-map/persistent-apartment-map-app";
import { getCurrentUserId } from "@/lib/server/auth/session";
import { listWorkspaceListingLeads } from "@/lib/server/listing-leads-db";
import { listWorkspacePlanningThreadCache } from "@/lib/server/planning/store-db";
import {
  getOrCreateDefaultWorkspace,
  serializeWorkspaceMapSnapshot,
  serializeWorkspaceRecord,
} from "@/lib/server/workspaces";

export default async function Home() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return <ApartmentMapApp />;
  }

  const initialState = await loadPersistentInitialState(userId);
  return <PersistentApartmentMapApp initialState={initialState} />;
}

async function loadPersistentInitialState(userId: string) {
  try {
    const { workspace, mapSnapshot } = await getOrCreateDefaultWorkspace(userId);
    const listings = await listWorkspaceListingLeads(workspace.id);
    const planningThreadCache = await listWorkspacePlanningThreadCache({
      workspaceId: workspace.id,
      mapSnapshot,
      listingLedgerRevision: listings.listingLedgerRevision,
    });

    return {
      workspace: serializeWorkspaceRecord(workspace),
      mapSnapshot: serializeWorkspaceMapSnapshot(mapSnapshot),
      listingLeads: listings.leads,
      listingLedgerRevision: listings.listingLedgerRevision,
      planningThreadCache,
    };
  } catch (error) {
    if (
      process.env.NODE_ENV !== "production" &&
      error instanceof Error &&
      error.message.includes("DATABASE_URL is required")
    ) {
      return null;
    }

    throw error;
  }
}
