import "server-only";

import { eq, sql } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import { mapSnapshots, workspaces } from "@/lib/db/schema";
import { createRevision } from "@/lib/db/workspace-revisions";
import { onboardingProgressSchema } from "@/lib/domain/schemas";
import type {
  OnboardingProgress,
  WorkspaceMapSnapshot,
  WorkspaceRecord,
  WorkspaceResponse,
} from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { createDefaultOnboardingProgress } from "@/lib/onboarding/progress";

type WorkspaceRow = typeof workspaces.$inferSelect;
type MapSnapshotRow = typeof mapSnapshots.$inferSelect;

let workspaceSchemaCompatibilityPromise: Promise<void> | null = null;

export async function getOrCreateDefaultWorkspace(userId: string, now = new Date()) {
  const database = requireDb();
  await ensureWorkspaceSchemaCompatibility(database);

  const workspaceId = `workspace-${crypto.randomUUID()}`;
  const listingLedgerRevision = createRevision("ledger");

  const [workspace] = await database
    .insert(workspaces)
    .values({
      id: workspaceId,
      userId,
      name: "Apartment hunt",
      listingLedgerRevision,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaces.userId,
      set: { updatedAt: now },
    })
    .returning();

  const existingSnapshots = await database
    .select()
    .from(mapSnapshots)
    .where(eq(mapSnapshots.workspaceId, workspace.id))
    .limit(1);

  if (existingSnapshots[0]) {
    return { workspace, mapSnapshot: existingSnapshots[0] };
  }

  const [mapSnapshot] = await database
    .insert(mapSnapshots)
    .values({
      id: `snapshot-${crypto.randomUUID()}`,
      workspaceId: workspace.id,
      revision: createRevision("map"),
      mapState: seedMapState,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mapSnapshots.workspaceId,
      set: { updatedAt: now },
    })
    .returning();

  return { workspace, mapSnapshot };
}

async function ensureWorkspaceSchemaCompatibility(database: ReturnType<typeof requireDb>) {
  workspaceSchemaCompatibilityPromise ??= database
    .execute(sql`ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "onboarding_progress" jsonb`)
    .then(() => undefined)
    .catch((error: unknown) => {
      workspaceSchemaCompatibilityPromise = null;
      throw error;
    });

  await workspaceSchemaCompatibilityPromise;
}

export async function deleteDefaultWorkspaceForUser(userId: string) {
  const deletedRows = await requireDb()
    .delete(workspaces)
    .where(eq(workspaces.userId, userId))
    .returning({ id: workspaces.id });

  return { deleted: deletedRows.length > 0 };
}

export function serializeWorkspaceRecord(workspace: {
  id: string;
  userId: string;
  name: string;
  listingLedgerRevision: string;
  onboardingProgress?: OnboardingProgress | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): WorkspaceRecord {
  const updatedAt = toIsoString(workspace.updatedAt);

  return {
    id: workspace.id,
    userId: workspace.userId,
    name: workspace.name,
    listingLedgerRevision: workspace.listingLedgerRevision,
    onboardingProgress: normalizeOnboardingProgress(workspace.onboardingProgress, updatedAt),
    createdAt: toIsoString(workspace.createdAt),
    updatedAt,
  };
}

function normalizeOnboardingProgress(value: unknown, now = new Date().toISOString()) {
  const parsed = onboardingProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : createDefaultOnboardingProgress(now);
}

export function serializeWorkspaceMapSnapshot(mapSnapshot: {
  id: string;
  workspaceId: string;
  revision: string;
  mapState: MapSnapshotRow["mapState"];
  createdAt: Date | string;
  updatedAt: Date | string;
}): WorkspaceMapSnapshot {
  return {
    id: mapSnapshot.id,
    workspaceId: mapSnapshot.workspaceId,
    revision: mapSnapshot.revision,
    mapState: mapSnapshot.mapState,
    createdAt: toIsoString(mapSnapshot.createdAt),
    updatedAt: toIsoString(mapSnapshot.updatedAt),
  };
}

export function serializeWorkspaceResponse(input: {
  workspace: WorkspaceRow | WorkspaceRecord;
  mapSnapshot: MapSnapshotRow | WorkspaceMapSnapshot;
}): WorkspaceResponse {
  return {
    workspace: isSerializedWorkspaceRecord(input.workspace)
      ? input.workspace
      : serializeWorkspaceRecord(input.workspace),
    mapSnapshot: isSerializedWorkspaceMapSnapshot(input.mapSnapshot)
      ? input.mapSnapshot
      : serializeWorkspaceMapSnapshot(input.mapSnapshot),
    listingLedgerRevision: input.workspace.listingLedgerRevision,
  };
}

function isSerializedWorkspaceRecord(value: WorkspaceRow | WorkspaceRecord): value is WorkspaceRecord {
  return typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isSerializedWorkspaceMapSnapshot(
  value: MapSnapshotRow | WorkspaceMapSnapshot,
): value is WorkspaceMapSnapshot {
  return typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function toIsoString(value: Date | string) {
  return typeof value === "string" ? value : value.toISOString();
}
