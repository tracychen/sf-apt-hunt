import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import {
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
  ExecutePlanningActionResponse,
  ListingLead,
  MapSnapshot,
  WorkspaceMapSnapshot,
  PlanningActionExecutionRecord,
  PlanningActionRecord,
  PlanningContextSummary,
  PlanningMessage,
  PlanningThread,
} from "@/lib/domain/types";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";
import { updateWorkspaceListingStatus } from "@/lib/server/listing-leads-db";
import { mergeReappearingListingLead } from "@/lib/server/planning/listing-leads";
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
import { updateWorkspaceMap } from "@/lib/server/workspace-state";

export function createDbPlanningStore(workspaceId: string): PlanningStore {
  return {
    async createThread(input) {
      return createThread(workspaceId, input);
    },
    async resetInstallation() {
      return resetWorkspacePlanning(workspaceId);
    },
    async getThread(threadId) {
      const thread = await requireDb().query.planningThreads.findFirst({
        where: and(eq(planningThreads.id, threadId), eq(planningThreads.workspaceId, workspaceId)),
      });

      return thread ? serializePlanningThread(thread, workspaceId) : null;
    },
    async verifyThreadOwnership(threadId) {
      const thread = await requireDb().query.planningThreads.findFirst({
        where: and(eq(planningThreads.id, threadId), eq(planningThreads.workspaceId, workspaceId)),
      });

      return Boolean(thread);
    },
    async appendMessage(input) {
      return appendMessage(workspaceId, input);
    },
    async getMessage(messageId) {
      const message = await requireDb().query.planningMessages.findFirst({
        where: and(eq(planningMessages.id, messageId), eq(planningMessages.workspaceId, workspaceId)),
      });

      return message ? serializePlanningMessage(message) : null;
    },
    async listRecentMessages(threadId, limit) {
      const messages = await requireDb().query.planningMessages.findMany({
        where: and(eq(planningMessages.threadId, threadId), eq(planningMessages.workspaceId, workspaceId)),
      });

      return messages
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(-limit)
        .map((message) => serializePlanningMessage(message));
    },
    async createAction(input) {
      return createAction(workspaceId, input);
    },
    async getAction(actionId) {
      const action = await requireDb().query.planningActions.findFirst({
        where: and(eq(planningActions.id, actionId), eq(planningActions.workspaceId, workspaceId)),
      });

      return action ? serializePlanningAction(action) : null;
    },
    async listRecentActions(threadId, limit) {
      const actions = await requireDb().query.planningActions.findMany({
        where: and(eq(planningActions.threadId, threadId), eq(planningActions.workspaceId, workspaceId)),
      });

      return actions
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(-limit)
        .map((action) => serializePlanningAction(action));
    },
    async updateAction(input) {
      return updateAction(workspaceId, input);
    },
    async claimActionExecution(input) {
      return claimActionExecution(workspaceId, input);
    },
    async createExecution(input) {
      return createExecution(workspaceId, input);
    },
    async getExecution(executionId) {
      const execution = await requireDb().query.planningActionExecutions.findFirst({
        where: and(
          eq(planningActionExecutions.id, executionId),
          eq(planningActionExecutions.workspaceId, workspaceId),
        ),
      });

      return execution ? serializePlanningExecution(execution) : null;
    },
    async getExecutionByIdempotencyKey(actionId, idempotencyKey) {
      const execution = await requireDb().query.planningActionExecutions.findFirst({
        where: and(
          eq(planningActionExecutions.actionId, actionId),
          eq(planningActionExecutions.idempotencyKey, idempotencyKey),
          eq(planningActionExecutions.workspaceId, workspaceId),
        ),
      });

      return execution ? serializePlanningExecution(execution) : null;
    },
    async getMapSnapshot(threadId) {
      const thread = await requireDb().query.planningThreads.findFirst({
        where: and(eq(planningThreads.id, threadId), eq(planningThreads.workspaceId, workspaceId)),
      });

      if (!thread) {
        return null;
      }

      const snapshot = await requireDb().query.mapSnapshots.findFirst({
        where: eq(mapSnapshots.workspaceId, workspaceId),
      });

      return snapshot ? serializePlanningMapSnapshot(snapshot, thread.id, workspaceId) : null;
    },
    async getListingLead(threadId, canonicalUrl) {
      const thread = await requireDb().query.planningThreads.findFirst({
        where: and(eq(planningThreads.id, threadId), eq(planningThreads.workspaceId, workspaceId)),
      });

      if (!thread) {
        return null;
      }

      const lead = await requireDb().query.listingLeads.findFirst({
        where: and(eq(listingLeads.workspaceId, workspaceId), eq(listingLeads.canonicalUrl, canonicalUrl)),
      });

      return lead ? serializeListingLead(lead) : null;
    },
    async getListingLedgerRevision(threadId) {
      const thread = await requireDb().query.planningThreads.findFirst({
        where: and(eq(planningThreads.id, threadId), eq(planningThreads.workspaceId, workspaceId)),
      });

      if (!thread) {
        return null;
      }

      const workspace = await requireDb().query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
      });

      return workspace?.listingLedgerRevision ?? null;
    },
    async getPreferenceMemory(threadId) {
      return getPreferenceMemory(workspaceId, threadId);
    },
    async updatePreferenceMemory(input) {
      return updatePreferenceMemory(workspaceId, input);
    },
    async updateMapSnapshot(input) {
      return updateMapSnapshot(workspaceId, input);
    },
    async updateListingLeadStatus(input) {
      return updateListingLeadStatus(workspaceId, input);
    },
    async buildExecutionResponse(actionId, executionId) {
      return buildExecutionResponse(workspaceId, actionId, executionId);
    },
    hashPayload(payload) {
      return hashPayload(payload);
    },
  };
}

export async function listWorkspacePlanningThreadCache(input: {
  workspaceId: string;
  mapSnapshot: typeof mapSnapshots.$inferSelect | WorkspaceMapSnapshot;
  listingLedgerRevision: string;
}): Promise<PlanningThreadCache | null> {
  const database = requireDb();
  const threads = await database.query.planningThreads.findMany({
    where: eq(planningThreads.workspaceId, input.workspaceId),
  });
  const latestThread = threads
    .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
    .at(-1);

  if (!latestThread) {
    return null;
  }

  const [messages, actions] = await Promise.all([
    database.query.planningMessages.findMany({
      where: and(
        eq(planningMessages.workspaceId, input.workspaceId),
        eq(planningMessages.threadId, latestThread.id),
      ),
    }),
    database.query.planningActions.findMany({
      where: and(
        eq(planningActions.workspaceId, input.workspaceId),
        eq(planningActions.threadId, latestThread.id),
      ),
    }),
  ]);
  const orderedMessages = messages.sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const contextSummariesByMessageId = Object.fromEntries(
    orderedMessages
      .filter((message) => message.contextSummary)
      .map((message) => [message.id, message.contextSummary as PlanningContextSummary]),
  );
  const latestContextSummary =
    orderedMessages
      .filter((message) => message.contextSummary)
      .at(-1)?.contextSummary ?? emptyPlanningContextSummary();

  return {
    thread: serializePlanningThread(latestThread, input.workspaceId),
    messages: orderedMessages.map((message) => serializePlanningMessage(message)),
    actionRecords: actions
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((action) => serializePlanningAction(action)),
    contextSummary: latestContextSummary,
    contextSummariesByMessageId,
    mapSnapshot: serializePlanningMapSnapshot(
      {
        ...input.mapSnapshot,
        createdAt: new Date(input.mapSnapshot.createdAt),
        updatedAt: new Date(input.mapSnapshot.updatedAt),
      },
      latestThread.id,
      input.workspaceId,
    ),
    listingLedgerRevision: input.listingLedgerRevision,
  };
}

class PlanningStoreOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningStoreOwnershipError";
  }
}

async function createThread(
  workspaceId: string,
  input: CreateThreadInput,
): Promise<CreateThreadStoreResult> {
  const database = requireDb();
  const now = new Date(input.now);

  return database.transaction(async (tx) => {
    const workspace = await tx.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });

    if (!workspace) {
      return { ok: false, error: "installation_record_invalid" };
    }

    let snapshot = await tx.query.mapSnapshots.findFirst({
      where: eq(mapSnapshots.workspaceId, workspaceId),
    });

    if (!snapshot) {
      [snapshot] = await tx
        .insert(mapSnapshots)
        .values({
          id: `snapshot-${crypto.randomUUID()}`,
          workspaceId,
          revision: createRevision("map"),
          mapState: input.initialMapState,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }

    if (!snapshot) {
      return { ok: false, error: "installation_record_invalid" };
    }

    const [thread] = await tx
      .insert(planningThreads)
      .values({
        id: `thread-${crypto.randomUUID()}`,
        workspaceId,
        title: "Apartment planning",
        summary: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!thread) {
      return { ok: false, error: "installation_record_invalid" };
    }

    return {
      ok: true,
      thread: serializePlanningThread(thread, workspaceId),
      mapSnapshot: serializePlanningMapSnapshot(snapshot, thread.id, workspaceId),
      listingLedgerRevision: workspace.listingLedgerRevision,
    };
  });
}

async function resetWorkspacePlanning(workspaceId: string) {
  const database = requireDb();

  await database.transaction(async (tx) => {
    await tx.delete(planningActionExecutions).where(eq(planningActionExecutions.workspaceId, workspaceId));
    await tx.delete(planningActions).where(eq(planningActions.workspaceId, workspaceId));
    await tx.delete(planningMessages).where(eq(planningMessages.workspaceId, workspaceId));
    await tx.delete(planningThreads).where(eq(planningThreads.workspaceId, workspaceId));
  });

  return { ok: true } as const;
}

async function appendMessage(workspaceId: string, input: AppendMessageInput) {
  const database = requireDb();
  const now = new Date(input.now);

  return database.transaction(async (tx) => {
    await requireWorkspaceThread(tx, workspaceId, input.threadId);

    const [message] = await tx
      .insert(planningMessages)
      .values({
        id: `message-${crypto.randomUUID()}`,
        workspaceId,
        threadId: input.threadId,
        role: input.role,
        parts: input.parts,
        contextSummary: null,
        createdAt: now,
      })
      .returning();

    await tx
      .update(planningThreads)
      .set({ updatedAt: now })
      .where(and(eq(planningThreads.id, input.threadId), eq(planningThreads.workspaceId, workspaceId)))
      .returning();

    if (!message) {
      throw new Error("Planning message was not persisted.");
    }

    return serializePlanningMessage(message);
  });
}

async function createAction(workspaceId: string, input: CreateActionInput) {
  const database = requireDb();
  const now = new Date(input.now);
  return database.transaction(async (tx) => {
    const thread = await requireWorkspaceThread(tx, workspaceId, input.threadId);
    const message = await requireWorkspaceMessage(tx, workspaceId, input.messageId);

    if (message.threadId !== thread.id) {
      throw new PlanningStoreOwnershipError(
        "Planning message is not owned by this workspace thread.",
      );
    }

    const [action] = await tx
      .insert(planningActions)
      .values({
        id: input.id,
        workspaceId,
        threadId: input.threadId,
        messageId: input.messageId,
        partIndex: input.partIndex,
        kind: input.kind,
        target: input.target,
        status: "pending",
        error: null,
        failureKind: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!action) {
      throw new Error("Planning action was not persisted.");
    }

    await seedListingLeadFromMessage(tx, workspaceId, action);

    return serializePlanningAction(action);
  });
}

async function requireWorkspaceThread(
  database: Pick<ReturnType<typeof requireDb>, "query">,
  workspaceId: string,
  threadId: string,
) {
  const thread = await database.query.planningThreads.findFirst({
    where: and(eq(planningThreads.id, threadId), eq(planningThreads.workspaceId, workspaceId)),
  });

  if (!thread) {
    throw new PlanningStoreOwnershipError("Planning thread is not owned by this workspace.");
  }

  return thread;
}

async function requireWorkspaceMessage(
  database: Pick<ReturnType<typeof requireDb>, "query">,
  workspaceId: string,
  messageId: string,
) {
  const message = await database.query.planningMessages.findFirst({
    where: and(eq(planningMessages.id, messageId), eq(planningMessages.workspaceId, workspaceId)),
  });

  if (!message) {
    throw new PlanningStoreOwnershipError("Planning message is not owned by this workspace.");
  }

  return message;
}

async function updateAction(workspaceId: string, input: UpdateActionInput): Promise<UpdateActionResult> {
  const current = await requireDb().query.planningActions.findFirst({
    where: and(eq(planningActions.id, input.actionId), eq(planningActions.workspaceId, workspaceId)),
  });

  if (!current) {
    return { ok: false, error: "action_not_found" };
  }

  if (input.onlyIfNotTerminal && isTerminalAction(current)) {
    return { ok: false, error: "action_terminal" };
  }

  const [action] = await requireDb()
    .update(planningActions)
    .set({
      status: input.status,
      updatedAt: new Date(input.now),
      error: input.error ?? null,
      failureKind: input.failureKind ?? null,
    })
    .where(and(eq(planningActions.id, input.actionId), eq(planningActions.workspaceId, workspaceId)))
    .returning();

  if (!action) {
    return { ok: false, error: "action_not_found" };
  }

  return { ok: true, action: serializePlanningAction(action) };
}

async function claimActionExecution(
  workspaceId: string,
  input: ClaimActionExecutionInput,
): Promise<ClaimActionExecutionResult> {
  return requireDb().transaction(async (tx) => {
    const action = await tx.query.planningActions.findFirst({
      where: and(eq(planningActions.id, input.actionId), eq(planningActions.workspaceId, workspaceId)),
    });

    if (!action) {
      return { status: "action_not_found" } as const;
    }

    if (isTerminalAction(action)) {
      return { status: "action_terminal" } as const;
    }

    const [claimedExecution] = await tx
      .insert(planningActionExecutions)
      .values({
        id: `execution-${crypto.randomUUID()}`,
        workspaceId,
        actionId: input.actionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        status: "in_progress",
        error: null,
        createdAt: new Date(input.now),
      })
      .onConflictDoNothing({
        target: [planningActionExecutions.actionId, planningActionExecutions.idempotencyKey],
      })
      .returning();

    if (claimedExecution) {
      return { status: "claimed" } as const;
    }

    const existingExecution = await tx.query.planningActionExecutions.findFirst({
      where: and(
        eq(planningActionExecutions.actionId, input.actionId),
        eq(planningActionExecutions.idempotencyKey, input.idempotencyKey),
        eq(planningActionExecutions.workspaceId, workspaceId),
      ),
    });

    if (!existingExecution) {
      throw new Error("Planning action execution claim lost without a stored execution row.");
    }

    if (existingExecution.payloadHash !== input.payloadHash) {
      return { status: "conflict" } as const;
    }

    if (existingExecution.status === "in_progress") {
      return { status: "in_progress" } as const;
    }

    return { status: "completed", executionId: existingExecution.id } as const;
  });
}

async function createExecution(workspaceId: string, input: CreateExecutionInput) {
  return requireDb().transaction(async (tx) => {
    const existingExecution = await tx.query.planningActionExecutions.findFirst({
      where: and(
        eq(planningActionExecutions.actionId, input.actionId),
        eq(planningActionExecutions.idempotencyKey, input.idempotencyKey),
        eq(planningActionExecutions.workspaceId, workspaceId),
      ),
    });

    if (existingExecution) {
      if (existingExecution.payloadHash !== input.payloadHash) {
        throw new Error("Planning execution payload hash does not match the claimed execution.");
      }

      if (existingExecution.status !== "in_progress") {
        return serializePlanningExecution(existingExecution);
      }

      const [updatedExecution] = await tx
        .update(planningActionExecutions)
        .set({
          status: input.status,
          error: input.error ?? null,
        })
        .where(
          and(
            eq(planningActionExecutions.id, existingExecution.id),
            eq(planningActionExecutions.workspaceId, workspaceId),
          ),
        )
        .returning();

      if (!updatedExecution) {
        throw new Error("Planning execution claim could not be finalized.");
      }

      return serializePlanningExecution(updatedExecution);
    }

    const [execution] = await tx
      .insert(planningActionExecutions)
      .values({
        id: `execution-${crypto.randomUUID()}`,
        workspaceId,
        actionId: input.actionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        status: input.status,
        error: input.error ?? null,
        createdAt: new Date(input.now),
      })
      .onConflictDoNothing({
        target: [planningActionExecutions.actionId, planningActionExecutions.idempotencyKey],
      })
      .returning();

    if (execution) {
      return serializePlanningExecution(execution);
    }

    const conflictedExecution = await tx.query.planningActionExecutions.findFirst({
      where: and(
        eq(planningActionExecutions.actionId, input.actionId),
        eq(planningActionExecutions.idempotencyKey, input.idempotencyKey),
        eq(planningActionExecutions.workspaceId, workspaceId),
      ),
    });

    if (!conflictedExecution) {
      throw new Error("Planning execution was not persisted.");
    }

    if (conflictedExecution.payloadHash !== input.payloadHash) {
      throw new Error("Planning execution payload hash does not match the stored execution.");
    }

    return serializePlanningExecution(conflictedExecution);
  });
}

async function getPreferenceMemory(workspaceId: string, threadId: string) {
  const messages = await requireDb().query.planningMessages.findMany({
    where: and(eq(planningMessages.threadId, threadId), eq(planningMessages.workspaceId, workspaceId)),
  });
  const latest = messages
    .filter((message) => message.contextSummary)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .at(-1);

  return latest?.contextSummary ?? null;
}

async function updatePreferenceMemory(
  workspaceId: string,
  input: {
    threadId: string;
    context: PlanningContextSummary;
    now: string;
  },
) {
  const current = (await getPreferenceMemory(workspaceId, input.threadId)) ?? emptyPlanningContextSummary();
  const nextMemory = mergePreferenceMemory(current, input.context);
  const messages = await requireDb().query.planningMessages.findMany({
    where: and(eq(planningMessages.threadId, input.threadId), eq(planningMessages.workspaceId, workspaceId)),
  });
  const latestMessage = messages.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()).at(-1);

  if (latestMessage) {
    await requireDb()
      .update(planningMessages)
      .set({ contextSummary: nextMemory })
      .where(and(eq(planningMessages.id, latestMessage.id), eq(planningMessages.workspaceId, workspaceId)))
      .returning();
  }

  await requireDb()
    .update(planningThreads)
    .set({ updatedAt: new Date(input.now) })
    .where(and(eq(planningThreads.id, input.threadId), eq(planningThreads.workspaceId, workspaceId)))
    .returning();

  return nextMemory;
}

async function updateMapSnapshot(
  workspaceId: string,
  input: UpdateMapSnapshotInput,
): Promise<UpdateMapSnapshotResult> {
  const thread = await requireDb().query.planningThreads.findFirst({
    where: and(eq(planningThreads.id, input.threadId), eq(planningThreads.workspaceId, workspaceId)),
  });

  if (!thread) {
    return { ok: false, error: "thread_not_found" };
  }

  const result = await updateWorkspaceMap({
    workspaceId,
    expectedMapRevision: input.expectedRevision,
    mapState: input.mapState,
    now: new Date(input.now),
  });

  if (!result.ok) {
    return { ok: false, error: "stale_map_revision" };
  }

  await requireDb()
    .update(planningThreads)
    .set({ updatedAt: new Date(input.now) })
    .where(and(eq(planningThreads.id, input.threadId), eq(planningThreads.workspaceId, workspaceId)))
    .returning();

  return {
    ok: true,
    snapshot: {
      id: result.mapSnapshot.id,
      threadId: input.threadId,
      clientInstallationId: workspaceId,
      mapState: result.mapSnapshot.mapState,
      revision: result.mapSnapshot.revision,
      createdAt: result.mapSnapshot.createdAt,
      updatedAt: result.mapSnapshot.updatedAt,
    },
  };
}

async function updateListingLeadStatus(
  workspaceId: string,
  input: UpdateListingLeadStatusInput,
): Promise<UpdateListingLeadStatusResult> {
  const thread = await requireDb().query.planningThreads.findFirst({
    where: and(eq(planningThreads.id, input.threadId), eq(planningThreads.workspaceId, workspaceId)),
  });

  if (!thread) {
    return { ok: false, error: "thread_not_found" };
  }

  const result = await updateWorkspaceListingStatus({
    workspaceId,
    canonicalUrl: input.canonicalUrl,
    expectedListingLedgerRevision: input.expectedRevision,
    status: input.status,
    now: new Date(input.now),
  });

  if (!result.ok) {
    if (result.error === "listing_not_found") {
      return { ok: false, error: "listing_lead_not_found" };
    }

    return { ok: false, error: "stale_listing_ledger_revision" };
  }

  return {
    ok: true,
    lead: result.lead,
    listingLedgerRevision: result.listingLedgerRevision,
  };
}

async function buildExecutionResponse(
  workspaceId: string,
  actionId: string,
  executionId: string,
): Promise<ExecutePlanningActionResponse> {
  const [action, execution] = await Promise.all([
    requireDb().query.planningActions.findFirst({
      where: and(eq(planningActions.id, actionId), eq(planningActions.workspaceId, workspaceId)),
    }),
    requireDb().query.planningActionExecutions.findFirst({
      where: and(
        eq(planningActionExecutions.id, executionId),
        eq(planningActionExecutions.workspaceId, workspaceId),
      ),
    }),
  ]);

  if (!action || !execution) {
    throw new Error("Planning execution response records are missing.");
  }

  const response: ExecutePlanningActionResponse = {
    action: serializePlanningAction(action),
    execution: serializePlanningExecution(execution),
  };

  if (
    action.target.kind === "mapProposal" ||
    action.target.kind === "mapProposalItem" ||
    action.target.kind === "targetEdit"
  ) {
    const snapshot = await createDbPlanningStore(workspaceId).getMapSnapshot(action.threadId);

    return snapshot ? { ...response, mapSnapshot: snapshot, mapState: snapshot.mapState } : response;
  }

  if (action.target.kind === "listingLead") {
    const [lead, listingLedgerRevision] = await Promise.all([
      createDbPlanningStore(workspaceId).getListingLead(action.threadId, action.target.canonicalUrl),
      createDbPlanningStore(workspaceId).getListingLedgerRevision(action.threadId),
    ]);

    return lead && listingLedgerRevision
      ? { ...response, listingLead: lead, listingLedgerRevision }
      : response;
  }

  return response;
}

async function seedListingLeadFromMessage(
  database: Pick<ReturnType<typeof requireDb>, "query" | "insert" | "update">,
  workspaceId: string,
  action: typeof planningActions.$inferSelect,
) {
  if (action.target.kind !== "listingLead" || action.kind !== "listingSave") {
    return;
  }
  const target = action.target;

  const message = await database.query.planningMessages.findFirst({
    where: and(eq(planningMessages.id, action.messageId), eq(planningMessages.workspaceId, workspaceId)),
  });

  if (!message) {
    return;
  }

  const part = message.parts[action.partIndex];

  if (part?.type !== "listingResults") {
    return;
  }

  const card = part.listings.find(
    (listing: { lead: ListingLead }) => listing.lead.canonicalUrl === target.canonicalUrl,
  );

  if (!card) {
    return;
  }

  const existing = await database.query.listingLeads.findFirst({
    where: and(
      eq(listingLeads.workspaceId, workspaceId),
      eq(listingLeads.canonicalUrl, target.canonicalUrl),
    ),
  });
  const mergedLead = mergeReappearingListingLead(existing ? serializeListingLead(existing) : null, card.lead);
  const nextListingLedgerRevision = createRevision("ledger");

  if (existing) {
    await database
      .update(listingLeads)
      .set({
        firstSeenAt: new Date(mergedLead.firstSeenAt),
        lastSeenAt: new Date(mergedLead.lastSeenAt),
        lastSearchQuery: mergedLead.lastSearchQuery,
        seenCount: mergedLead.seenCount,
        status: mergedLead.status,
        candidate: mergedLead.candidate,
        updatedAt: new Date(action.updatedAt),
      })
      .where(and(eq(listingLeads.workspaceId, workspaceId), eq(listingLeads.canonicalUrl, mergedLead.canonicalUrl)))
      .returning();
  } else {
    await database
      .insert(listingLeads)
      .values({
        id: `lead-${crypto.randomUUID()}`,
        workspaceId,
        canonicalUrl: mergedLead.canonicalUrl,
        firstSeenAt: new Date(mergedLead.firstSeenAt),
        lastSeenAt: new Date(mergedLead.lastSeenAt),
        lastSearchQuery: mergedLead.lastSearchQuery,
        seenCount: mergedLead.seenCount,
        status: mergedLead.status,
        candidate: mergedLead.candidate,
        createdAt: new Date(action.createdAt),
        updatedAt: new Date(action.updatedAt),
      })
      .returning();
  }

  await database
    .update(workspaces)
    .set({
      listingLedgerRevision: nextListingLedgerRevision,
      updatedAt: new Date(action.updatedAt),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning();
}

function serializePlanningThread(
  thread: typeof planningThreads.$inferSelect,
  workspaceId: string,
): PlanningThread {
  return {
    id: thread.id,
    clientInstallationId: workspaceId,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    title: thread.title,
    summary: thread.summary,
  };
}

function serializePlanningMessage(message: typeof planningMessages.$inferSelect): PlanningMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt.toISOString(),
  };
}

function serializePlanningAction(action: typeof planningActions.$inferSelect): PlanningActionRecord {
  return {
    id: action.id,
    threadId: action.threadId,
    messageId: action.messageId,
    partIndex: action.partIndex,
    kind: action.kind,
    target: action.target,
    status: action.status,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
    ...(action.error ? { error: action.error } : {}),
    ...(action.failureKind ? { failureKind: action.failureKind } : {}),
  };
}

function serializePlanningExecution(
  execution: typeof planningActionExecutions.$inferSelect,
): PlanningActionExecutionRecord {
  return {
    id: execution.id,
    actionId: execution.actionId,
    idempotencyKey: execution.idempotencyKey,
    payloadHash: execution.payloadHash,
    status: execution.status,
    createdAt: execution.createdAt.toISOString(),
    ...(execution.error ? { error: execution.error } : {}),
  };
}

function serializePlanningMapSnapshot(
  snapshot: typeof mapSnapshots.$inferSelect,
  threadId: string,
  workspaceId: string,
): MapSnapshot {
  return {
    id: snapshot.id,
    threadId,
    clientInstallationId: workspaceId,
    mapState: snapshot.mapState,
    revision: snapshot.revision,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

function serializeListingLead(lead: typeof listingLeads.$inferSelect): ListingLead {
  return {
    canonicalUrl: lead.canonicalUrl,
    firstSeenAt: lead.firstSeenAt.toISOString(),
    lastSeenAt: lead.lastSeenAt.toISOString(),
    lastSearchQuery: lead.lastSearchQuery,
    seenCount: lead.seenCount,
    status: lead.status,
    candidate: {
      ...lead.candidate,
      url: lead.canonicalUrl,
    },
  };
}

function isTerminalAction(
  action: Pick<typeof planningActions.$inferSelect, "status" | "failureKind">,
) {
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
