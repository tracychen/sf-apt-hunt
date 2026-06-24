import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import {
  facebookListingCaptures,
  geocodeCacheEntries,
  listingLeads,
  mapSnapshots,
  planningActionExecutions,
  planningActions,
  planningMessages,
  planningThreads,
  workspaces,
} from "@/lib/db/schema";
import { createRevision } from "@/lib/db/workspace-revisions";
import type {
  ImportWorkspaceMapResponse,
  MapState,
  PutWorkspaceMapResponse,
  WorkspaceResetResponse,
} from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import {
  serializeWorkspaceMapSnapshot,
  serializeWorkspaceRecord,
} from "@/lib/server/workspaces";

const mapActionKinds = ["mapProposal", "mapProposalItem", "targetEdit"] as const;

type WorkspaceDb = ReturnType<typeof requireDb>;
type WorkspaceWriteClient = Pick<WorkspaceDb, "query" | "update">;
type WorkspaceReadClient = Pick<WorkspaceDb, "query">;

class WorkspaceResetConflictError extends Error {
  constructor() {
    super("Workspace revisions are stale.");
  }
}

export async function updateWorkspaceMap(input: {
  workspaceId: string;
  expectedMapRevision: string;
  mapState: MapState;
  now?: Date;
  staleActionError?: string;
}): Promise<PutWorkspaceMapResponse> {
  const database = requireDb();
  const now = input.now ?? new Date();

  return database.transaction(async (tx) => {
    const nextRevision = createRevision("map");
    const [snapshot] = await tx
      .update(mapSnapshots)
      .set({
        mapState: input.mapState,
        revision: nextRevision,
        updatedAt: now,
      })
      .where(
        and(
          eq(mapSnapshots.workspaceId, input.workspaceId),
          eq(mapSnapshots.revision, input.expectedMapRevision),
        ),
      )
      .returning();

    if (!snapshot) {
      const current = await tx.query.mapSnapshots.findFirst({
        where: eq(mapSnapshots.workspaceId, input.workspaceId),
      });

      return {
        ok: false,
        error: "stale_map_revision",
        currentMapRevision: current?.revision ?? "",
      };
    }

    const invalidatedActionIds = await invalidatePendingMapActions(tx, {
      workspaceId: input.workspaceId,
      oldMapRevision: input.expectedMapRevision,
      error: input.staleActionError ?? "Map changed before this proposal was applied.",
      now,
    });

    return {
      ok: true,
      mapSnapshot: serializeWorkspaceMapSnapshot(snapshot),
      invalidatedActionIds,
    };
  });
}

export async function importWorkspaceMap(input: {
  workspaceId: string;
  expectedMapRevision: string;
  mapState: MapState;
  now?: Date;
}): Promise<ImportWorkspaceMapResponse> {
  return updateWorkspaceMap({
    ...input,
    staleActionError: "Map was replaced by JSON import.",
  });
}

export async function resetWorkspace(input: {
  workspaceId: string;
  expectedMapRevision: string;
  expectedListingLedgerRevision: string;
  now?: Date;
}): Promise<WorkspaceResetResponse> {
  const database = requireDb();
  const now = input.now ?? new Date();

  try {
    return await database.transaction(async (tx) => {
      const nextMapRevision = createRevision("map");
      const nextLedgerRevision = createRevision("ledger");
      const [nextWorkspace] = await tx
        .update(workspaces)
        .set({
          listingLedgerRevision: nextLedgerRevision,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.listingLedgerRevision, input.expectedListingLedgerRevision),
          ),
        )
        .returning();

      if (!nextWorkspace) {
        throw new WorkspaceResetConflictError();
      }

      const [nextSnapshot] = await tx
        .update(mapSnapshots)
        .set({
          revision: nextMapRevision,
          mapState: seedMapState,
          updatedAt: now,
        })
        .where(
          and(
            eq(mapSnapshots.workspaceId, input.workspaceId),
            eq(mapSnapshots.revision, input.expectedMapRevision),
          ),
        )
        .returning();

      if (!nextSnapshot) {
        throw new WorkspaceResetConflictError();
      }

      await deleteWorkspaceProductRows(tx, input.workspaceId);

      return {
        ok: true,
        workspace: serializeWorkspaceRecord(nextWorkspace),
        mapSnapshot: serializeWorkspaceMapSnapshot(nextSnapshot),
        listingLedgerRevision: nextWorkspace.listingLedgerRevision,
      };
    });
  } catch (error) {
    if (!(error instanceof WorkspaceResetConflictError)) {
      throw error;
    }

    const current = await readWorkspaceRevisions(database, input.workspaceId);

    return {
      ok: false,
      error: "stale_workspace_revision",
      currentMapRevision: current.currentMapRevision,
      currentListingLedgerRevision: current.currentListingLedgerRevision,
    };
  }
}

async function deleteWorkspaceProductRows(
  database: Pick<WorkspaceDb, "delete">,
  workspaceId: string,
) {
  await database
    .delete(planningActionExecutions)
    .where(eq(planningActionExecutions.workspaceId, workspaceId));
  await database.delete(planningActions).where(eq(planningActions.workspaceId, workspaceId));
  await database.delete(planningMessages).where(eq(planningMessages.workspaceId, workspaceId));
  await database.delete(planningThreads).where(eq(planningThreads.workspaceId, workspaceId));
  await database.delete(geocodeCacheEntries).where(eq(geocodeCacheEntries.workspaceId, workspaceId));
  await database
    .delete(facebookListingCaptures)
    .where(eq(facebookListingCaptures.workspaceId, workspaceId));
  await database.delete(listingLeads).where(eq(listingLeads.workspaceId, workspaceId));
}

async function invalidatePendingMapActions(
  database: WorkspaceWriteClient,
  input: {
    workspaceId: string;
    oldMapRevision: string;
    error: string;
    now: Date;
  },
) {
  const pending = await database.query.planningActions.findMany({
    where: and(
      eq(planningActions.workspaceId, input.workspaceId),
      eq(planningActions.status, "pending"),
      inArray(planningActions.kind, mapActionKinds),
    ),
  });
  const matching = pending.filter((action) => {
    const target = action.target;
    return "mapRevision" in target && target.mapRevision === input.oldMapRevision;
  });

  if (matching.length === 0) {
    return [];
  }

  await database
    .update(planningActions)
    .set({
      status: "failed",
      failureKind: "permanent",
      error: input.error,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(planningActions.workspaceId, input.workspaceId),
        inArray(
          planningActions.id,
          matching.map((action) => action.id),
        ),
      ),
    );

  return matching.map((action) => action.id);
}

async function readWorkspaceRevisions(database: WorkspaceReadClient, workspaceId: string) {
  const [workspace, snapshot] = await Promise.all([
    database.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    }),
    database.query.mapSnapshots.findFirst({
      where: eq(mapSnapshots.workspaceId, workspaceId),
    }),
  ]);

  return {
    currentMapRevision: snapshot?.revision ?? "",
    currentListingLedgerRevision: workspace?.listingLedgerRevision ?? "",
  };
}
