import { beforeEach, describe, expect, test, vi } from "vitest";

import { listingLeads, mapSnapshots, planningActionExecutions, planningActions, planningMessages, planningThreads, workspaces } from "@/lib/db/schema";
import { seedMapState } from "@/lib/map/seed-data";

const createRevisionMock = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof createPlanningStoreDbMock> | null,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => {
    if (!dbMock.current) {
      throw new Error("Database mock not initialized");
    }

    return dbMock.current;
  },
}));

vi.mock("@/lib/db/workspace-revisions", () => ({
  createRevision: createRevisionMock,
}));

import { createDbPlanningStore } from "@/lib/server/planning/store-db";

type WorkspaceRow = ReturnType<typeof createWorkspaceRow>;
type SnapshotRow = ReturnType<typeof createSnapshotRow>;
type ThreadRow = {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
};
type MessageRow = {
  id: string;
  workspaceId: string;
  threadId: string;
  role: "user" | "assistant";
  parts: unknown[];
  contextSummary: unknown;
  createdAt: Date;
};
type ActionRow = {
  id: string;
  workspaceId: string;
  threadId: string;
  messageId: string;
  partIndex: number;
  kind: "mapProposal" | "mapProposalItem" | "listingSave" | "listingDismiss" | "targetEdit";
  target: unknown;
  status: "pending" | "applied" | "dismissed" | "failed";
  error: string | null;
  failureKind: "retryable" | "permanent" | null;
  createdAt: Date;
  updatedAt: Date;
};
type ExecutionRow = {
  id: string;
  workspaceId: string;
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: "in_progress" | "succeeded" | "failed";
  error: string | null;
  createdAt: Date;
};
type ListingLeadRow = {
  id: string;
  workspaceId: string;
  canonicalUrl: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSearchQuery: string;
  seenCount: number;
  status: "new" | "seen" | "saved" | "dismissed";
  candidate: unknown;
  createdAt: Date;
  updatedAt: Date;
};
type PlanningStoreDbState = {
  workspaces: WorkspaceRow[];
  snapshots: SnapshotRow[];
  threads: ThreadRow[];
  messages: MessageRow[];
  actions: ActionRow[];
  executions: ExecutionRow[];
  listingLeads: ListingLeadRow[];
};

describe("planning-store-db", () => {
  beforeEach(() => {
    dbMock.current = createPlanningStoreDbMock();
    createRevisionMock.mockReset();
    createRevisionMock.mockReturnValue("ledger-seeded");
  });

  test("creates workspace-owned threads and messages", async () => {
    const store = createDbPlanningStore("workspace-1");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    await store.appendMessage({
      threadId: created.thread.id,
      role: "user",
      parts: [{ type: "text", text: "Find listings" }],
      now: "2026-06-23T12:00:01.000Z",
    });

    const messages = await store.listRecentMessages(created.thread.id, 10);

    expect(messages).toHaveLength(1);
    expect(created.thread.clientInstallationId).toBe("workspace-1");
    expect(created.mapSnapshot.clientInstallationId).toBe("workspace-1");
    expect(getCurrentDb().state.threads[0]?.workspaceId).toBe("workspace-1");
    expect(getCurrentDb().state.messages[0]?.workspaceId).toBe("workspace-1");
  });

  test("appendMessage rejects a thread from a different workspace", async () => {
    const store = createDbPlanningStore("workspace-1");
    const otherStore = createDbPlanningStore("workspace-2");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    await expect(
      otherStore.appendMessage({
        threadId: created.thread.id,
        role: "user",
        parts: [{ type: "text", text: "Cross-workspace write" }],
        now: "2026-06-23T12:00:01.000Z",
      }),
    ).rejects.toThrow("Planning thread is not owned by this workspace.");

    expect(getCurrentDb().state.messages).toHaveLength(0);
  });

  test("rejects action ownership from a different workspace", async () => {
    const store = createDbPlanningStore("workspace-1");
    const otherStore = createDbPlanningStore("workspace-2");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "text", text: "Review this action" }],
      now: "2026-06-23T12:00:01.000Z",
    });
    const action = await store.createAction({
      id: "action-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: message.id,
        partIndex: 0,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-23T12:00:02.000Z",
    });

    await expect(otherStore.verifyThreadOwnership(created.thread.id, "ignored")).resolves.toBe(false);
    await expect(otherStore.getAction(action.id)).resolves.toBeNull();
    await expect(
      otherStore.claimActionExecution({
        actionId: action.id,
        idempotencyKey: "idem-1",
        payloadHash: "payload-hash-1",
        now: "2026-06-23T12:00:03.000Z",
      }),
    ).resolves.toEqual({ status: "action_not_found" });
  });

  test("createAction rejects parent records from a different workspace", async () => {
    const store = createDbPlanningStore("workspace-1");
    const otherStore = createDbPlanningStore("workspace-2");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "text", text: "Create this action" }],
      now: "2026-06-23T12:00:01.000Z",
    });

    await expect(
      otherStore.createAction({
        id: "action-cross-workspace-1",
        threadId: created.thread.id,
        messageId: message.id,
        partIndex: 0,
        kind: "mapProposal",
        target: {
          kind: "mapProposal",
          messageId: message.id,
          partIndex: 0,
          proposalHash: "hash-cross-workspace-1",
          allowedOperationIndexes: [0],
          mapRevision: created.mapSnapshot.revision,
        },
        now: "2026-06-23T12:00:02.000Z",
      }),
    ).rejects.toThrow("Planning thread is not owned by this workspace.");

    expect(getCurrentDb().state.actions).toHaveLength(0);
  });

  test("idempotency keys are unique per action", async () => {
    const store = createDbPlanningStore("workspace-1");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "text", text: "Apply this action" }],
      now: "2026-06-23T12:00:01.000Z",
    });

    await store.createAction({
      id: "action-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: message.id,
        partIndex: 0,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-23T12:00:02.000Z",
    });

    const firstClaim = await store.claimActionExecution({
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payloadHash: "payload-hash-1",
      now: "2026-06-23T12:00:03.000Z",
    });
    const secondClaim = await store.claimActionExecution({
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payloadHash: "payload-hash-1",
      now: "2026-06-23T12:00:04.000Z",
    });

    expect(firstClaim).toEqual({ status: "claimed" });
    expect(secondClaim.status === "in_progress" || secondClaim.status === "completed").toBe(true);

    const execution = await store.createExecution({
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payloadHash: "payload-hash-1",
      status: "succeeded",
      now: "2026-06-23T12:00:05.000Z",
    });
    const thirdClaim = await store.claimActionExecution({
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payloadHash: "payload-hash-1",
      now: "2026-06-23T12:00:06.000Z",
    });

    expect(execution.id).toBeTruthy();
    expect(thirdClaim).toEqual({ status: "completed", executionId: execution.id });
    expect(getCurrentDb().state.executions).toHaveLength(1);
  });

  test("claimActionExecution persists in-progress claims in the database", async () => {
    const store = createDbPlanningStore("workspace-1");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "text", text: "Apply this action" }],
      now: "2026-06-23T12:00:01.000Z",
    });

    await store.createAction({
      id: "action-claim-db-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: message.id,
        partIndex: 0,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-23T12:00:02.000Z",
    });

    const claim = await store.claimActionExecution({
      actionId: "action-claim-db-1",
      idempotencyKey: "idem-db-claim-1",
      payloadHash: "payload-hash-1",
      now: "2026-06-23T12:00:03.000Z",
    });

    expect(claim).toEqual({ status: "claimed" });
    expect(getCurrentDb().state.executions).toHaveLength(1);
    expect(getCurrentDb().state.executions[0]).toMatchObject({
      actionId: "action-claim-db-1",
      idempotencyKey: "idem-db-claim-1",
      payloadHash: "payload-hash-1",
      status: "in_progress",
    });

    delete (globalThis as Record<string, unknown>).__sfAptHuntWorkspaceActionClaimsV1;

    const repeatedClaim = await createDbPlanningStore("workspace-1").claimActionExecution({
      actionId: "action-claim-db-1",
      idempotencyKey: "idem-db-claim-1",
      payloadHash: "payload-hash-1",
      now: "2026-06-23T12:00:04.000Z",
    });

    expect(repeatedClaim).toEqual({ status: "in_progress" });
  });

  test("createExecution finalizes the claimed row without inserting a duplicate", async () => {
    const store = createDbPlanningStore("workspace-1");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "text", text: "Apply this action" }],
      now: "2026-06-23T12:00:01.000Z",
    });

    await store.createAction({
      id: "action-finalize-db-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: message.id,
        partIndex: 0,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-23T12:00:02.000Z",
    });

    await store.claimActionExecution({
      actionId: "action-finalize-db-1",
      idempotencyKey: "idem-db-finalize-1",
      payloadHash: "payload-hash-1",
      now: "2026-06-23T12:00:03.000Z",
    });

    const placeholder = getCurrentDb().state.executions[0];
    const execution = await store.createExecution({
      actionId: "action-finalize-db-1",
      idempotencyKey: "idem-db-finalize-1",
      payloadHash: "payload-hash-1",
      status: "succeeded",
      now: "2026-06-23T12:00:04.000Z",
    });

    expect(execution.id).toBe(placeholder?.id);
    expect(getCurrentDb().state.executions).toHaveLength(1);
    expect(getCurrentDb().state.executions[0]).toMatchObject({
      id: placeholder?.id,
      status: "succeeded",
      payloadHash: "payload-hash-1",
    });
  });

  test("seeding a planning listing lead advances the workspace listing ledger revision", async () => {
    const store = createDbPlanningStore("workspace-1");
    const created = await store.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-23T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const lead = createListingLead("https://example.com/listing-seeded");
    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [
        { type: "text", text: "I found 1 listing candidate." },
        {
          type: "listingResults",
          resultSetId: "result-set-1",
          listings: [
            {
              lead,
              display: {
                ...lead.candidate,
                canonicalUrl: lead.canonicalUrl,
                leadStatus: lead.status,
                firstSeenAt: lead.firstSeenAt,
                lastSeenAt: lead.lastSeenAt,
                seenCount: lead.seenCount,
                planningScore: 4,
                planningSignals: [],
              },
              saveActionId: "action-listing-save-1",
              dismissActionId: "action-listing-dismiss-1",
            },
          ],
          sourceSummary: "",
          caveats: [],
          geocodeAuthorization: null,
        },
      ],
      now: "2026-06-23T12:00:01.000Z",
    });

    await store.createAction({
      id: "action-listing-save-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 1,
      kind: "listingSave",
      target: {
        kind: "listingLead",
        resultSetId: "result-set-1",
        canonicalUrl: lead.canonicalUrl,
        listingSnapshotHash: "listing-hash-1",
        listingLedgerRevision: "ledger-1",
      },
      now: "2026-06-23T12:00:02.000Z",
    });

    expect(getCurrentDb().state.listingLeads).toHaveLength(1);
    expect(getCurrentDb().state.workspaces[0]?.listingLedgerRevision).toBe("ledger-seeded");
    await expect(store.getListingLedgerRevision(created.thread.id)).resolves.toBe("ledger-seeded");
  });
});

function getCurrentDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

function createPlanningStoreDbMock() {
  let committedState: PlanningStoreDbState = {
    workspaces: [
      createWorkspaceRow("workspace-1", "user-1", "ledger-1"),
      createWorkspaceRow("workspace-2", "user-2", "ledger-2"),
    ],
    snapshots: [
      createSnapshotRow("snapshot-1", "workspace-1", "map-1"),
      createSnapshotRow("snapshot-2", "workspace-2", "map-2"),
    ],
    threads: [],
    messages: [],
    actions: [],
    executions: [],
    listingLeads: [],
  };
  let transactionalState = committedState;

  const tx = createDatabaseClient(
    () => transactionalState,
    (nextState) => {
      transactionalState = nextState;
    },
  );

  return {
    ...createDatabaseClient(
      () => committedState,
      (nextState) => {
        committedState = nextState;
      },
    ),
    get state() {
      return committedState;
    },
    async transaction<T>(callback: (innerTx: typeof tx) => Promise<T>) {
      transactionalState = structuredClone(committedState);

      try {
        const result = await callback(tx);
        committedState = transactionalState;
        return result;
      } finally {
        transactionalState = committedState;
      }
    },
  };
}

function createDatabaseClient(
  getState: () => PlanningStoreDbState,
  setState: (state: PlanningStoreDbState) => void,
) {
  return {
    query: {
      workspaces: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().workspaces.find((row: WorkspaceRow) => matchesCondition(row, where)),
      },
      mapSnapshots: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().snapshots.find((row: SnapshotRow) => matchesCondition(row, where)),
      },
      planningThreads: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().threads.find((row: ThreadRow) => matchesCondition(row, where)),
        findMany: async ({ where }: { where: unknown }) =>
          getState().threads.filter((row: ThreadRow) => matchesCondition(row, where)),
      },
      planningMessages: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().messages.find((row: MessageRow) => matchesCondition(row, where)),
        findMany: async ({ where }: { where: unknown }) =>
          getState().messages.filter((row: MessageRow) => matchesCondition(row, where)),
      },
      planningActions: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().actions.find((row: ActionRow) => matchesCondition(row, where)),
        findMany: async ({ where }: { where: unknown }) =>
          getState().actions.filter((row: ActionRow) => matchesCondition(row, where)),
      },
      planningActionExecutions: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().executions.find((row: ExecutionRow) => matchesCondition(row, where)),
        findMany: async ({ where }: { where: unknown }) =>
          getState().executions.filter((row: ExecutionRow) => matchesCondition(row, where)),
      },
      listingLeads: {
        findFirst: async ({ where }: { where: unknown }) =>
          getState().listingLeads.find((row: ListingLeadRow) => matchesCondition(row, where)),
      },
    },
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          const performInsert = () => {
            const state = structuredClone(getState());

            if (table === planningThreads) {
              state.threads.push({
                id: value.id as string,
                workspaceId: value.workspaceId as string,
                title: value.title as string,
                summary: value.summary as string,
                createdAt: value.createdAt as Date,
                updatedAt: value.updatedAt as Date,
              });
              setState(state);
              return [state.threads.at(-1)];
            }

            if (table === planningMessages) {
              state.messages.push({
                id: value.id as string,
                workspaceId: value.workspaceId as string,
                threadId: value.threadId as string,
                role: value.role as "user" | "assistant",
                parts: value.parts as unknown[],
                contextSummary: (value.contextSummary as unknown) ?? null,
                createdAt: value.createdAt as Date,
              });
              setState(state);
              return [state.messages.at(-1)];
            }

            if (table === planningActions) {
              state.actions.push({
                id: value.id as string,
                workspaceId: value.workspaceId as string,
                threadId: value.threadId as string,
                messageId: value.messageId as string,
                partIndex: value.partIndex as number,
                kind: value.kind as "mapProposal" | "mapProposalItem" | "listingSave" | "listingDismiss" | "targetEdit",
                target: value.target,
                status: value.status as "pending" | "applied" | "dismissed" | "failed",
                error: (value.error as string | null | undefined) ?? null,
                failureKind: (value.failureKind as "retryable" | "permanent" | null | undefined) ?? null,
                createdAt: value.createdAt as Date,
                updatedAt: value.updatedAt as Date,
              });
              setState(state);
              return [state.actions.at(-1)];
            }

            if (table === planningActionExecutions) {
              state.executions.push({
                id: value.id as string,
                workspaceId: value.workspaceId as string,
                actionId: value.actionId as string,
                idempotencyKey: value.idempotencyKey as string,
                payloadHash: value.payloadHash as string,
                status: value.status as "in_progress" | "succeeded" | "failed",
                error: (value.error as string | null | undefined) ?? null,
                createdAt: value.createdAt as Date,
              });
              setState(state);
              return [state.executions.at(-1)];
            }

            if (table === listingLeads) {
              state.listingLeads.push({
                id: value.id as string,
                workspaceId: value.workspaceId as string,
                canonicalUrl: value.canonicalUrl as string,
                firstSeenAt: value.firstSeenAt as Date,
                lastSeenAt: value.lastSeenAt as Date,
                lastSearchQuery: value.lastSearchQuery as string,
                seenCount: value.seenCount as number,
                status: value.status as "new" | "seen" | "saved" | "dismissed",
                candidate: value.candidate,
                createdAt: value.createdAt as Date,
                updatedAt: value.updatedAt as Date,
              });
              setState(state);
              return [state.listingLeads.at(-1)];
            }

            if (table === mapSnapshots) {
              state.snapshots.push({
                id: value.id as string,
                workspaceId: value.workspaceId as string,
                revision: value.revision as string,
                mapState: value.mapState as typeof seedMapState,
                createdAt: value.createdAt as Date,
                updatedAt: value.updatedAt as Date,
              });
              setState(state);
              return [state.snapshots.at(-1)];
            }

            if (table === workspaces) {
              state.workspaces.push({
                id: value.id as string,
                userId: value.userId as string,
                name: value.name as string,
                listingLedgerRevision: value.listingLedgerRevision as string,
                createdAt: value.createdAt as Date,
                updatedAt: value.updatedAt as Date,
              });
              setState(state);
              return [state.workspaces.at(-1)];
            }

            throw new Error("Unexpected insert table");
          };

          return {
            async returning() {
              return performInsert();
            },
            onConflictDoNothing() {
              return {
                async returning() {
                  if (table !== planningActionExecutions) {
                    return performInsert();
                  }

                  const existing = getState().executions.find(
                    (row) =>
                      row.actionId === value.actionId &&
                      row.idempotencyKey === value.idempotencyKey,
                  );

                  if (existing) {
                    return [];
                  }

                  return performInsert();
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: unknown) {
              const state = structuredClone(getState());
              const rows = getTableRows(state, table);
              const updatedRows = rows.map((row: Record<string, unknown>) =>
                matchesCondition(row, condition) ? { ...row, ...values } : row,
              );
              const returning = updatedRows.filter((_row: Record<string, unknown>, index: number) =>
                matchesCondition(rows[index], condition),
              );

              setTableRows(state, table, updatedRows);
              setState(state);

              return { returning: async () => returning };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(condition: unknown) {
          const state = structuredClone(getState());
          const rows = getTableRows(state, table);
          const nextRows = rows.filter((row: Record<string, unknown>) => !matchesCondition(row, condition));

          setTableRows(state, table, nextRows);
          setState(state);

          return {
            returning: async () =>
              rows.filter((row: Record<string, unknown>) => matchesCondition(row, condition)),
          };
        },
      };
    },
  };
}

function createWorkspaceRow(id: string, userId: string, listingLedgerRevision: string) {
  return {
    id,
    userId,
    name: "Apartment hunt",
    listingLedgerRevision,
    createdAt: new Date("2026-06-23T11:00:00.000Z"),
    updatedAt: new Date("2026-06-23T11:00:00.000Z"),
  };
}

function createSnapshotRow(id: string, workspaceId: string, revision: string) {
  return {
    id,
    workspaceId,
    revision,
    mapState: structuredClone(seedMapState),
    createdAt: new Date("2026-06-23T11:00:00.000Z"),
    updatedAt: new Date("2026-06-23T11:00:00.000Z"),
  };
}

function getTableRows(state: PlanningStoreDbState, table: unknown): Record<string, unknown>[] {
  if (table === workspaces) {
    return state.workspaces;
  }

  if (table === mapSnapshots) {
    return state.snapshots;
  }

  if (table === planningThreads) {
    return state.threads;
  }

  if (table === planningMessages) {
    return state.messages;
  }

  if (table === planningActions) {
    return state.actions;
  }

  if (table === planningActionExecutions) {
    return state.executions;
  }

  if (table === listingLeads) {
    return state.listingLeads;
  }

  throw new Error("Unexpected table");
}

function setTableRows(
  state: PlanningStoreDbState,
  table: unknown,
  rows: unknown[],
) {
  if (table === workspaces) {
    state.workspaces = rows as typeof state.workspaces;
    return;
  }

  if (table === mapSnapshots) {
    state.snapshots = rows as typeof state.snapshots;
    return;
  }

  if (table === planningThreads) {
    state.threads = rows as typeof state.threads;
    return;
  }

  if (table === planningMessages) {
    state.messages = rows as typeof state.messages;
    return;
  }

  if (table === planningActions) {
    state.actions = rows as typeof state.actions;
    return;
  }

  if (table === planningActionExecutions) {
    state.executions = rows as typeof state.executions;
    return;
  }

  if (table === listingLeads) {
    state.listingLeads = rows as typeof state.listingLeads;
    return;
  }

  throw new Error("Unexpected table");
}

function createListingLead(canonicalUrl: string) {
  return {
    canonicalUrl,
    firstSeenAt: "2026-06-23T12:00:00.000Z",
    lastSeenAt: "2026-06-23T12:00:00.000Z",
    lastSearchQuery: "mission studio",
    seenCount: 1,
    status: "seen" as const,
    candidate: {
      id: "candidate-seeded",
      title: "Sunny studio",
      url: canonicalUrl,
      sourceDomain: "example.com",
      neighborhoodGuess: "Mission",
      locationText: "Mission St",
      geocodeQuery: null,
      locationConfidence: "medium" as const,
      coordinates: null,
      geocodeStatus: "not_attempted" as const,
      markerPrecision: "none" as const,
      priceMonthly: 2900,
      beds: "studio" as const,
      shortTermSignal: false,
      furnishedSignal: false,
      fitScore: 4 as const,
      whyItFits: "Near preferred areas.",
      citations: [
        {
          url: canonicalUrl,
          title: "Listing",
          sourceDomain: "example.com",
        },
      ],
      caveats: [],
    },
  };
}

function matchesCondition(record: Record<string, unknown>, condition: unknown): boolean {
  if (!condition || typeof condition !== "object") {
    return true;
  }

  const typedCondition = condition as {
    type?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };

  if (typedCondition.type === "and") {
    return (typedCondition.conditions ?? []).every((nested) => matchesCondition(record, nested));
  }

  if (typedCondition.type === "eq") {
    return readColumnValue(record, typedCondition.column) === typedCondition.value;
  }

  return true;
}

function readColumnValue(record: Record<string, unknown>, column: unknown) {
  switch (column) {
    case workspaces.id:
    case planningThreads.id:
    case planningMessages.id:
    case planningActions.id:
    case planningActionExecutions.id:
    case listingLeads.id:
    case mapSnapshots.id:
      return record.id;
    case workspaces.listingLedgerRevision:
      return record.listingLedgerRevision;
    case workspaces.userId:
      return record.userId;
    case mapSnapshots.workspaceId:
    case planningThreads.workspaceId:
    case planningMessages.workspaceId:
    case planningActions.workspaceId:
    case planningActionExecutions.workspaceId:
    case listingLeads.workspaceId:
      return record.workspaceId;
    case mapSnapshots.revision:
      return record.revision;
    case planningMessages.threadId:
    case planningActions.threadId:
      return record.threadId;
    case planningActions.messageId:
      return record.messageId;
    case planningActions.status:
      return record.status;
    case planningActionExecutions.actionId:
      return record.actionId;
    case planningActionExecutions.idempotencyKey:
      return record.idempotencyKey;
    case listingLeads.canonicalUrl:
      return record.canonicalUrl;
    default:
      return undefined;
  }
}
