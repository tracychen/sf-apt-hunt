import { z } from "zod";

import {
  listingLeadSchema,
  mapSnapshotSchema,
  planningActionRecordSchema,
  planningContextSummarySchema,
  planningMessageSchema,
  planningThreadSchema,
  workspaceMapSnapshotSchema,
  workspaceRecordSchema,
} from "@/lib/domain/schemas";
import type {
  ListingLead,
  WorkspaceMapSnapshot,
  WorkspaceRecord,
} from "@/lib/domain/types";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";

export type PersistentWorkspaceInitialState = {
  workspace: WorkspaceRecord;
  mapSnapshot: WorkspaceMapSnapshot;
  listingLeads: ListingLead[];
  listingLedgerRevision: string;
  planningThreadCache: PlanningThreadCache | null;
};

const planningThreadCacheSchema: z.ZodType<PlanningThreadCache> = z
  .object({
    thread: planningThreadSchema,
    messages: z.array(planningMessageSchema),
    actionRecords: z.array(planningActionRecordSchema),
    contextSummary: planningContextSummarySchema,
    contextSummariesByMessageId: z.record(z.string(), planningContextSummarySchema),
    mapSnapshot: mapSnapshotSchema,
    listingLedgerRevision: z.string().min(1),
  })
  .strict();

export const persistentWorkspaceInitialStateSchema: z.ZodType<PersistentWorkspaceInitialState> = z
  .object({
    workspace: workspaceRecordSchema,
    mapSnapshot: workspaceMapSnapshotSchema,
    listingLeads: z.array(listingLeadSchema),
    listingLedgerRevision: z.string().min(1),
    planningThreadCache: planningThreadCacheSchema.nullable(),
  })
  .strict();
