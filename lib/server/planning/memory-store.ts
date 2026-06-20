import { createHash } from "node:crypto";

import type {
  ListingLead,
  MapSnapshot,
  PlanningActionExecutionRecord,
  PlanningActionRecord,
  PlanningContextSummary,
  PlanningMessage,
  PlanningThread,
} from "@/lib/domain/types";
import type {
  AppendMessageInput,
  ClaimActionExecutionInput,
  ClaimActionExecutionResult,
  CreateActionInput,
  CreateExecutionInput,
  CreateThreadInput,
  CreateThreadStoreResult,
  PlanningStore,
  UpdateActionInput,
  UpdateActionResult,
  UpdateListingLeadStatusInput,
  UpdateListingLeadStatusResult,
  UpdateMapSnapshotInput,
  UpdateMapSnapshotResult,
} from "@/lib/server/planning/store";
import { mergeReappearingListingLead } from "@/lib/server/planning/listing-leads";

type StoredInstallation = {
  id: string;
  secretHash: string;
  threadIds: string[];
};

type ActionExecutionClaim = {
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  createdAt: string;
  executionId?: string;
};

type MemoryPlanningStoreState = {
  installations: Map<string, StoredInstallation>;
  threads: Map<string, PlanningThread>;
  messages: Map<string, PlanningMessage>;
  actions: Map<string, PlanningActionRecord>;
  executions: Map<string, PlanningActionExecutionRecord>;
  executionIdsByIdempotencyKey: Map<string, string>;
  executionClaimsByIdempotencyKey: Map<string, ActionExecutionClaim>;
  mapSnapshots: Map<string, MapSnapshot>;
  listingLedgers: Map<string, { revision: string; leads: Map<string, ListingLead> }>;
  preferenceMemories: Map<string, PlanningContextSummary>;
  sequence: number;
};

export function createMemoryPlanningStore(): PlanningStore {
  const state: MemoryPlanningStoreState = {
    installations: new Map(),
    threads: new Map(),
    messages: new Map(),
    actions: new Map(),
    executions: new Map(),
    executionIdsByIdempotencyKey: new Map(),
    executionClaimsByIdempotencyKey: new Map(),
    mapSnapshots: new Map(),
    listingLedgers: new Map(),
    preferenceMemories: new Map(),
    sequence: 0,
  };

  return {
    async createThread(input) {
      return createThread(state, input);
    },
    async resetInstallation(input) {
      return resetInstallation(state, input);
    },
    async getThread(threadId) {
      return cloneValue(state.threads.get(threadId) ?? null);
    },
    async verifyThreadOwnership(threadId, installationSecretHash) {
      return verifyThreadOwnership(state, threadId, installationSecretHash);
    },
    async appendMessage(input) {
      return appendMessage(state, input);
    },
    async getMessage(messageId) {
      return cloneValue(state.messages.get(messageId) ?? null);
    },
    async listRecentMessages(threadId, limit) {
      return [...state.messages.values()]
        .filter((message) => message.threadId === threadId)
        .slice(-limit)
        .map((message) => cloneValue(message));
    },
    async createAction(input) {
      return createAction(state, input);
    },
    async getAction(actionId) {
      return cloneValue(state.actions.get(actionId) ?? null);
    },
    async listRecentActions(threadId, limit) {
      return [...state.actions.values()]
        .filter((action) => action.threadId === threadId)
        .slice(-limit)
        .map((action) => cloneValue(action));
    },
    async updateAction(input) {
      return updateAction(state, input);
    },
    async claimActionExecution(input) {
      return claimActionExecution(state, input);
    },
    async createExecution(input) {
      return createExecution(state, input);
    },
    async getExecution(executionId) {
      return cloneValue(state.executions.get(executionId) ?? null);
    },
    async getExecutionByIdempotencyKey(actionId, idempotencyKey) {
      const key = executionIdempotencyKey(actionId, idempotencyKey);
      const claim = state.executionClaimsByIdempotencyKey.get(key);
      const executionId = claim?.executionId ?? state.executionIdsByIdempotencyKey.get(key);

      return executionId ? cloneValue(state.executions.get(executionId) ?? null) : null;
    },
    async getMapSnapshot(threadId) {
      return cloneValue(state.mapSnapshots.get(threadId) ?? null);
    },
    async getListingLead(threadId, canonicalUrl) {
      return cloneValue(state.listingLedgers.get(threadId)?.leads.get(canonicalUrl) ?? null);
    },
    async getListingLedgerRevision(threadId) {
      return state.listingLedgers.get(threadId)?.revision ?? null;
    },
    async getPreferenceMemory(threadId) {
      return cloneValue(state.preferenceMemories.get(threadId) ?? null);
    },
    async updatePreferenceMemory(input) {
      return updatePreferenceMemory(state, input);
    },
    async updateMapSnapshot(input) {
      return updateMapSnapshot(state, input);
    },
    async updateListingLeadStatus(input) {
      return updateListingLeadStatus(state, input);
    },
    async buildExecutionResponse(actionId, executionId) {
      return buildExecutionResponse(state, actionId, executionId);
    },
    hashPayload(payload) {
      return hashPayload(payload);
    },
  };
}

function verifyThreadOwnership(
  state: MemoryPlanningStoreState,
  threadId: string,
  installationSecretHash: string,
) {
  const thread = state.threads.get(threadId);

  if (!thread) {
    return false;
  }

  const installation = state.installations.get(thread.clientInstallationId);

  return installation?.secretHash === installationSecretHash;
}

function resetInstallation(
  state: MemoryPlanningStoreState,
  input: {
    clientInstallationId: string;
    clientInstallationSecretHash: string;
  },
) {
  const installation = state.installations.get(input.clientInstallationId);

  if (!installation) {
    return { ok: false, error: "installation_not_found" } as const;
  }

  if (installation.secretHash !== input.clientInstallationSecretHash) {
    return { ok: false, error: "installation_secret_mismatch" } as const;
  }

  const threadIds = new Set(installation.threadIds);
  const actionIds = new Set<string>();

  for (const [actionId, action] of state.actions.entries()) {
    if (threadIds.has(action.threadId)) {
      actionIds.add(actionId);
      state.actions.delete(actionId);
    }
  }

  for (const [messageId, message] of state.messages.entries()) {
    if (threadIds.has(message.threadId)) {
      state.messages.delete(messageId);
    }
  }

  for (const [threadId] of state.threads.entries()) {
    if (threadIds.has(threadId)) {
      state.threads.delete(threadId);
      state.mapSnapshots.delete(threadId);
      state.listingLedgers.delete(threadId);
      state.preferenceMemories.delete(threadId);
    }
  }

  for (const [executionId, execution] of state.executions.entries()) {
    if (actionIds.has(execution.actionId)) {
      state.executions.delete(executionId);
    }
  }

  for (const [key, claim] of state.executionClaimsByIdempotencyKey.entries()) {
    if (actionIds.has(claim.actionId)) {
      state.executionClaimsByIdempotencyKey.delete(key);
      state.executionIdsByIdempotencyKey.delete(key);
    }
  }

  state.installations.delete(input.clientInstallationId);

  return { ok: true } as const;
}

function updatePreferenceMemory(
  state: MemoryPlanningStoreState,
  input: {
    threadId: string;
    context: PlanningContextSummary;
    now: string;
  },
) {
  const current = state.preferenceMemories.get(input.threadId) ?? emptyPlanningContextSummary();
  const nextMemory = mergePreferenceMemory(current, input.context);
  const thread = state.threads.get(input.threadId);

  if (thread) {
    state.threads.set(input.threadId, { ...thread, updatedAt: input.now });
  }
  state.preferenceMemories.set(input.threadId, cloneValue(nextMemory));

  return cloneValue(nextMemory);
}

function createThread(
  state: MemoryPlanningStoreState,
  input: CreateThreadInput,
): CreateThreadStoreResult {
  const installation = state.installations.get(input.clientInstallationId);

  if (installation && installation.secretHash !== input.clientInstallationSecretHash) {
    return { ok: false, error: "installation_secret_mismatch" };
  }

  const sequence = nextSequence(state);
  const threadId = `thread-${sequence}`;
  const snapshotId = `snapshot-${sequence}`;

  const thread: PlanningThread = {
    id: threadId,
    clientInstallationId: input.clientInstallationId,
    createdAt: input.now,
    updatedAt: input.now,
    title: "Apartment planning",
    summary: "",
  };
  const mapSnapshot: MapSnapshot = {
    id: snapshotId,
    threadId,
    clientInstallationId: input.clientInstallationId,
    mapState: cloneValue(input.initialMapState),
    revision: `map-rev-${sequence}`,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const nextInstallation = installation ?? {
    id: input.clientInstallationId,
    secretHash: input.clientInstallationSecretHash,
    threadIds: [],
  };

  state.installations.set(input.clientInstallationId, {
    ...nextInstallation,
    threadIds: [...nextInstallation.threadIds, threadId],
  });
  state.threads.set(threadId, cloneValue(thread));
  state.mapSnapshots.set(threadId, cloneValue(mapSnapshot));
  state.listingLedgers.set(threadId, {
    revision: `ledger-rev-${sequence}`,
    leads: new Map(),
  });

  return {
    ok: true,
    thread: cloneValue(thread),
    mapSnapshot: cloneValue(mapSnapshot),
    listingLedgerRevision: `ledger-rev-${sequence}`,
  };
}

function appendMessage(
  state: MemoryPlanningStoreState,
  input: AppendMessageInput,
): PlanningMessage {
  const sequence = nextSequence(state);
  const message: PlanningMessage = {
    id: `message-${sequence}`,
    threadId: input.threadId,
    role: input.role,
    parts: cloneValue(input.parts),
    createdAt: input.now,
  };
  const thread = state.threads.get(input.threadId);

  if (thread) {
    state.threads.set(input.threadId, { ...thread, updatedAt: input.now });
  }
  state.messages.set(message.id, cloneValue(message));

  return cloneValue(message);
}

function createAction(
  state: MemoryPlanningStoreState,
  input: CreateActionInput,
): PlanningActionRecord {
  const action: PlanningActionRecord = {
    id: input.id,
    threadId: input.threadId,
    messageId: input.messageId,
    partIndex: input.partIndex,
    kind: input.kind,
    target: cloneValue(input.target),
    status: "pending",
    createdAt: input.now,
    updatedAt: input.now,
  };

  state.actions.set(action.id, cloneValue(action));
  seedListingLeadFromMessage(state, action);

  return cloneValue(action);
}

function updateAction(
  state: MemoryPlanningStoreState,
  input: UpdateActionInput,
): UpdateActionResult {
  const action = state.actions.get(input.actionId);

  if (!action) {
    return { ok: false, error: "action_not_found" };
  }

  if (input.onlyIfNotTerminal && isTerminalAction(action)) {
    return { ok: false, error: "action_terminal" };
  }

  const nextAction: PlanningActionRecord = {
    ...action,
    status: input.status,
    updatedAt: input.now,
    error: input.error,
    failureKind: input.failureKind,
  };
  state.actions.set(action.id, cloneValue(nextAction));

  return { ok: true, action: cloneValue(nextAction) };
}

function claimActionExecution(
  state: MemoryPlanningStoreState,
  input: ClaimActionExecutionInput,
): ClaimActionExecutionResult {
  const key = executionIdempotencyKey(input.actionId, input.idempotencyKey);
  const existingClaim = state.executionClaimsByIdempotencyKey.get(key);
  const existingExecutionId = existingClaim?.executionId ?? state.executionIdsByIdempotencyKey.get(key);

  if (existingExecutionId) {
    const execution = state.executions.get(existingExecutionId);

    if (!execution) {
      return { status: "in_progress" };
    }

    return execution.payloadHash === input.payloadHash
      ? { status: "completed", executionId: existingExecutionId }
      : { status: "conflict" };
  }

  if (existingClaim) {
    return existingClaim.payloadHash === input.payloadHash
      ? { status: "in_progress" }
      : { status: "conflict" };
  }

  const action = state.actions.get(input.actionId);

  if (!action) {
    return { status: "action_not_found" };
  }

  if (isTerminalAction(action)) {
    return { status: "action_terminal" };
  }

  state.executionClaimsByIdempotencyKey.set(key, {
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: input.payloadHash,
    createdAt: input.now,
  });

  return { status: "claimed" };
}

function createExecution(
  state: MemoryPlanningStoreState,
  input: CreateExecutionInput,
): PlanningActionExecutionRecord {
  const sequence = nextSequence(state);
  const execution: PlanningActionExecutionRecord = {
    id: `execution-${sequence}`,
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: input.payloadHash,
    status: input.status,
    createdAt: input.now,
    error: input.error,
  };

  state.executions.set(execution.id, cloneValue(execution));
  state.executionClaimsByIdempotencyKey.set(
    executionIdempotencyKey(input.actionId, input.idempotencyKey),
    {
      actionId: input.actionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      createdAt: input.now,
      executionId: execution.id,
    },
  );
  state.executionIdsByIdempotencyKey.set(
    executionIdempotencyKey(input.actionId, input.idempotencyKey),
    execution.id,
  );

  return cloneValue(execution);
}

function updateMapSnapshot(
  state: MemoryPlanningStoreState,
  input: UpdateMapSnapshotInput,
): UpdateMapSnapshotResult {
  const current = state.mapSnapshots.get(input.threadId);

  if (!current) {
    return { ok: false, error: "thread_not_found" };
  }

  if (current.revision !== input.expectedRevision) {
    return { ok: false, error: "stale_map_revision" };
  }

  const sequence = nextSequence(state);
  const snapshot: MapSnapshot = {
    ...current,
    mapState: cloneValue(input.mapState),
    revision: `map-rev-${sequence}`,
    updatedAt: input.now,
  };
  const thread = state.threads.get(input.threadId);

  if (thread) {
    state.threads.set(input.threadId, { ...thread, updatedAt: input.now });
  }
  state.mapSnapshots.set(input.threadId, cloneValue(snapshot));

  return { ok: true, snapshot: cloneValue(snapshot) };
}

function updateListingLeadStatus(
  state: MemoryPlanningStoreState,
  input: UpdateListingLeadStatusInput,
): UpdateListingLeadStatusResult {
  const ledger = state.listingLedgers.get(input.threadId);

  if (!ledger) {
    return { ok: false, error: "thread_not_found" };
  }

  if (ledger.revision !== input.expectedRevision) {
    return { ok: false, error: "stale_listing_ledger_revision" };
  }

  const lead = ledger.leads.get(input.canonicalUrl);

  if (!lead) {
    return { ok: false, error: "listing_lead_not_found" };
  }

  if (lead.status === "saved" && input.status === "dismissed") {
    return { ok: false, error: "listing_lead_not_found" };
  }

  const sequence = nextSequence(state);
  const nextLead: ListingLead = { ...lead, status: input.status };
  const nextRevision = `ledger-rev-${sequence}`;

  ledger.leads.set(input.canonicalUrl, cloneValue(nextLead));
  ledger.revision = nextRevision;

  return {
    ok: true,
    lead: cloneValue(nextLead),
    listingLedgerRevision: nextRevision,
  };
}

function buildExecutionResponse(
  state: MemoryPlanningStoreState,
  actionId: string,
  executionId: string,
) {
  const action = state.actions.get(actionId);
  const execution = state.executions.get(executionId);

  if (!action || !execution) {
    throw new Error("Planning execution response records are missing.");
  }

  const response = {
    action: cloneValue(action),
    execution: cloneValue(execution),
  };

  if (
    action.target.kind === "mapProposal" ||
    action.target.kind === "mapProposalItem" ||
    action.target.kind === "targetEdit"
  ) {
    const snapshot = state.mapSnapshots.get(action.threadId);

    return snapshot
      ? { ...response, mapSnapshot: cloneValue(snapshot), mapState: cloneValue(snapshot.mapState) }
      : response;
  }

  if (action.target.kind === "listingLead") {
    const ledger = state.listingLedgers.get(action.threadId);
    const lead = ledger?.leads.get(action.target.canonicalUrl);

    return lead && ledger
      ? {
          ...response,
          listingLead: cloneValue(lead),
          listingLedgerRevision: ledger.revision,
        }
      : response;
  }

  return response;
}

function seedListingLeadFromMessage(
  state: MemoryPlanningStoreState,
  action: PlanningActionRecord,
) {
  if (action.target.kind !== "listingLead" || action.kind !== "listingSave") {
    return;
  }

  const canonicalUrl = action.target.canonicalUrl;
  const ledger = state.listingLedgers.get(action.threadId);
  const message = state.messages.get(action.messageId);

  if (!ledger || !message) {
    return;
  }

  const part = message.parts[action.partIndex];

  if (part?.type !== "listingResults") {
    return;
  }

  const card = part.listings.find((listing) => listing.lead.canonicalUrl === canonicalUrl);

  if (card) {
    const mergedLead = mergeReappearingListingLead(ledger.leads.get(canonicalUrl) ?? null, card.lead);
    ledger.leads.set(canonicalUrl, cloneValue(mergedLead));
  }
}

function nextSequence(state: MemoryPlanningStoreState) {
  state.sequence += 1;
  return state.sequence;
}

function executionIdempotencyKey(actionId: string, idempotencyKey: string) {
  return `${actionId}:${idempotencyKey}`;
}

function isTerminalAction(action: PlanningActionRecord) {
  return action.status === "applied" || action.status === "dismissed" || action.failureKind === "permanent";
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function emptyPlanningContextSummary(): PlanningContextSummary {
  return {
    budget: null,
    beds: null,
    timing: null,
    furnished: null,
    shortTerm: null,
    positiveAnchors: [],
    avoidAnchors: [],
    selectedZones: [],
    sourceStrictness: null,
  };
}

function mergePreferenceMemory(
  current: PlanningContextSummary,
  next: PlanningContextSummary,
): PlanningContextSummary {
  return {
    budget: next.budget ?? current.budget,
    beds: next.beds ?? current.beds,
    timing: next.timing ?? current.timing,
    furnished: next.furnished ?? current.furnished,
    shortTerm: next.shortTerm ?? current.shortTerm,
    positiveAnchors: next.positiveAnchors.length > 0 ? next.positiveAnchors : current.positiveAnchors,
    avoidAnchors: next.avoidAnchors.length > 0 ? next.avoidAnchors : current.avoidAnchors,
    selectedZones: next.selectedZones.length > 0 ? next.selectedZones : current.selectedZones,
    sourceStrictness: next.sourceStrictness ?? current.sourceStrictness,
  };
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}
