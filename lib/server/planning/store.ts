import type {
  ListingLead,
  ListingLeadStatus,
  MapSnapshot,
  MapState,
  PlanningActionExecutionRecord,
  PlanningActionRecord,
  PlanningActionTarget,
  PlanningChatPart,
  PlanningContextSummary,
  PlanningMessage,
  PlanningMessageRole,
  PlanningThread,
  ExecutePlanningActionResponse,
} from "@/lib/domain/types";
import { createDbPlanningStore } from "@/lib/server/planning/store-db";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";
import { createRedisPlanningStore } from "@/lib/server/planning/redis-store";

export type CreateThreadInput = {
  clientInstallationId: string;
  clientInstallationSecretHash: string;
  initialMapState: MapState;
  now: string;
};

export type UpdateMapSnapshotResult =
  | { ok: true; snapshot: MapSnapshot }
  | { ok: false; error: "thread_not_found" | "stale_map_revision" };

export type UpdateMapSnapshotInput = {
  threadId: string;
  expectedRevision: string;
  mapState: MapState;
  now: string;
};

export type AppendMessageInput = {
  threadId: string;
  role: PlanningMessageRole;
  parts: PlanningChatPart[];
  now: string;
};

export type CreateActionInput = {
  id: string;
  threadId: string;
  messageId: string;
  partIndex: number;
  kind: PlanningActionRecord["kind"];
  target: PlanningActionTarget;
  now: string;
};

export type UpdateActionInput = {
  actionId: string;
  status: PlanningActionRecord["status"];
  now: string;
  error?: string;
  failureKind?: PlanningActionRecord["failureKind"];
  onlyIfNotTerminal?: boolean;
};

export type UpdateActionResult =
  | { ok: true; action: PlanningActionRecord }
  | { ok: false; error: "action_not_found" | "action_terminal" };

export type CreateExecutionInput = {
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: PlanningActionExecutionRecord["status"];
  now: string;
  error?: string;
};

export type ClaimActionExecutionInput = {
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  now: string;
};

export type ClaimActionExecutionResult =
  | { status: "claimed" }
  | { status: "completed"; executionId: string }
  | { status: "conflict" }
  | { status: "in_progress" }
  | { status: "action_not_found" }
  | { status: "action_terminal" };

export type UpdateListingLeadStatusInput = {
  threadId: string;
  canonicalUrl: string;
  expectedRevision: string;
  status: Extract<ListingLeadStatus, "saved" | "dismissed">;
  now: string;
};

export type UpdateListingLeadStatusResult =
  | { ok: true; lead: ListingLead; listingLedgerRevision: string }
  | {
      ok: false;
      error: "thread_not_found" | "listing_lead_not_found" | "stale_listing_ledger_revision";
    };

export type CreateThreadResult = {
  thread: PlanningThread;
  mapSnapshot: MapSnapshot;
  listingLedgerRevision: string;
};

export type ResetInstallationResult =
  | { ok: true }
  | { ok: false; error: "installation_not_found" | "installation_secret_mismatch" };

export type CreateThreadStoreResult =
  | ({ ok: true } & CreateThreadResult)
  | { ok: false; error: "installation_secret_mismatch" | "installation_record_invalid" };

export type PlanningStore = {
  createThread(input: CreateThreadInput): Promise<CreateThreadStoreResult>;
  resetInstallation(input: {
    clientInstallationId: string;
    clientInstallationSecretHash: string;
  }): Promise<ResetInstallationResult>;
  getThread(threadId: string): Promise<PlanningThread | null>;
  verifyThreadOwnership(threadId: string, installationSecretHash: string): Promise<boolean>;
  appendMessage(input: AppendMessageInput): Promise<PlanningMessage>;
  getMessage(messageId: string): Promise<PlanningMessage | null>;
  listRecentMessages(threadId: string, limit: number): Promise<PlanningMessage[]>;
  createAction(input: CreateActionInput): Promise<PlanningActionRecord>;
  getAction(actionId: string): Promise<PlanningActionRecord | null>;
  listRecentActions(threadId: string, limit: number): Promise<PlanningActionRecord[]>;
  updateAction(input: UpdateActionInput): Promise<UpdateActionResult>;
  claimActionExecution(input: ClaimActionExecutionInput): Promise<ClaimActionExecutionResult>;
  createExecution(input: CreateExecutionInput): Promise<PlanningActionExecutionRecord>;
  getExecution(executionId: string): Promise<PlanningActionExecutionRecord | null>;
  getExecutionByIdempotencyKey(
    actionId: string,
    idempotencyKey: string,
  ): Promise<PlanningActionExecutionRecord | null>;
  getMapSnapshot(threadId: string): Promise<MapSnapshot | null>;
  getListingLead(threadId: string, canonicalUrl: string): Promise<ListingLead | null>;
  getListingLedgerRevision(threadId: string): Promise<string | null>;
  getPreferenceMemory(threadId: string): Promise<PlanningContextSummary | null>;
  updatePreferenceMemory(input: {
    threadId: string;
    context: PlanningContextSummary;
    now: string;
  }): Promise<PlanningContextSummary>;
  updateMapSnapshot(input: UpdateMapSnapshotInput): Promise<UpdateMapSnapshotResult>;
  updateListingLeadStatus(
    input: UpdateListingLeadStatusInput,
  ): Promise<UpdateListingLeadStatusResult>;
  buildExecutionResponse(
    actionId: string,
    executionId: string,
  ): Promise<ExecutePlanningActionResponse>;
  hashPayload(payload: unknown): string;
};

const planningStoreGlobalKey = "__sfAptHuntPlanningStoreV1";

type PlanningStoreGlobal = typeof globalThis & {
  [planningStoreGlobalKey]?: PlanningStore;
};

export function getPlanningStore(): PlanningStore {
  const planningStoreGlobal = globalThis as PlanningStoreGlobal;
  planningStoreGlobal[planningStoreGlobalKey] ??= hasRedisEnvironment()
    ? createRedisPlanningStore()
    : createMemoryPlanningStore();

  return planningStoreGlobal[planningStoreGlobalKey];
}

export function getPlanningStoreForWorkspace(workspaceId: string): PlanningStore {
  return createDbPlanningStore(workspaceId);
}

function hasRedisEnvironment() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
