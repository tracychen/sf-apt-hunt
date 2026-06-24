import { beforeEach, describe, expect, test, vi } from "vitest";

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
import type { MapState } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";

const createRevisionMock = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof createWorkspaceStateDbMock> | null,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ type: "inArray", column, values }),
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

import { resetWorkspace, updateWorkspaceMap } from "@/lib/server/workspace-state";

describe("workspace-state", () => {
  beforeEach(() => {
    dbMock.current = createWorkspaceStateDbMock();
    createRevisionMock.mockReset();
  });

  test("returns a stale response when the map revision does not match", async () => {
    const result = await updateWorkspaceMap({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-stale",
      mapState: seedMapState,
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_map_revision",
      currentMapRevision: "map-1",
    });
  });

  test("updates the map snapshot and invalidates matching pending map actions", async () => {
    createRevisionMock.mockReturnValueOnce("map-2");
    const nextMapState: MapState = {
      ...seedMapState,
      targets: [
        ...seedMapState.targets,
        {
          id: "new-target",
          name: "Hayes & Gough",
          purpose: "Test target",
          coordinates: [-122.426, 37.776],
          priority: "medium",
          influence: "positive",
          radiusMinutes: 10,
          notes: [],
        },
      ],
    };

    const result = await updateWorkspaceMap({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      mapState: nextMapState,
    });

    expect(result).toMatchObject({
      ok: true,
      invalidatedActionIds: ["action-1", "action-2"],
    });
    expect(result.ok && result.mapSnapshot.revision).toBe("map-2");
    expect(result.ok && result.mapSnapshot.mapState).toEqual(nextMapState);

    expect(getCurrentDb().state.snapshot.revision).toBe("map-2");
    expect(getCurrentDb().state.snapshot.mapState).toEqual(nextMapState);
    expect(getCurrentDb().state.planningActions[0]).toMatchObject({
      id: "action-1",
      status: "failed",
      failureKind: "permanent",
      error: "Map changed before this proposal was applied.",
    });
    expect(getCurrentDb().state.planningActions[1]).toMatchObject({
      id: "action-2",
      status: "failed",
      failureKind: "permanent",
      error: "Map changed before this proposal was applied.",
    });
    expect(getCurrentDb().state.planningActions[2].status).toBe("pending");
    expect(getCurrentDb().state.planningActions[3].status).toBe("pending");
  });

  test("returns stale when a concurrent map write wins before the update commits", async () => {
    createRevisionMock.mockReturnValueOnce("map-3");
    getCurrentDb().hooks.beforeSnapshotUpdate = () => {
      getCurrentDb().state.snapshot = {
        ...getCurrentDb().state.snapshot,
        revision: "map-2",
        updatedAt: new Date("2026-06-23T12:01:00.000Z"),
      };
    };

    const result = await updateWorkspaceMap({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      mapState: {
        ...seedMapState,
        targets: [],
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_map_revision",
      currentMapRevision: "map-2",
    });
    expect(getCurrentDb().state.snapshot.revision).toBe("map-2");
    expect(getCurrentDb().state.planningActions[0].status).toBe("pending");
    expect(getCurrentDb().state.planningActions[1].status).toBe("pending");
  });

  test("returns a stale response when reset revisions do not match", async () => {
    const result = await resetWorkspace({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-stale",
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_workspace_revision",
      currentMapRevision: "map-1",
      currentListingLedgerRevision: "ledger-1",
    });
  });

  test("resets the workspace to the seeded map with fresh revisions", async () => {
    createRevisionMock.mockReturnValueOnce("map-2").mockReturnValueOnce("ledger-2");

    const result = await resetWorkspace({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-1",
    });

    expect(result).toMatchObject({
      ok: true,
      listingLedgerRevision: "ledger-2",
    });
    expect(result.ok && result.workspace.listingLedgerRevision).toBe("ledger-2");
    expect(result.ok && result.mapSnapshot.revision).toBe("map-2");
    expect(result.ok && result.mapSnapshot.mapState).toEqual(seedMapState);

    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-2");
    expect(getCurrentDb().state.snapshot.revision).toBe("map-2");
    expect(getCurrentDb().state.snapshot.mapState).toEqual(seedMapState);
  });

  test("reset deletes workspace product rows and leaves other workspaces untouched", async () => {
    createRevisionMock.mockReturnValueOnce("map-2").mockReturnValueOnce("ledger-2");

    const result = await resetWorkspace({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-1",
    });

    expect(result.ok).toBe(true);
    expect(getCurrentDb().state.listingLeads.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
    expect(getCurrentDb().state.geocodeCacheEntries.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
    expect(getCurrentDb().state.facebookListingCaptures.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
    expect(getCurrentDb().state.planningThreads.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
    expect(getCurrentDb().state.planningMessages.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
    expect(getCurrentDb().state.planningActions.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
    expect(getCurrentDb().state.planningActionExecutions.map((row) => row.workspaceId)).toEqual(["workspace-2"]);
  });

  test("returns stale when the listing ledger changes before reset commits", async () => {
    createRevisionMock.mockReturnValueOnce("map-2").mockReturnValueOnce("ledger-3");
    getCurrentDb().hooks.beforeWorkspaceUpdate = () => {
      getCurrentDb().state.workspace = {
        ...getCurrentDb().state.workspace,
        listingLedgerRevision: "ledger-2",
        updatedAt: new Date("2026-06-23T12:01:00.000Z"),
      };
    };

    const result = await resetWorkspace({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_workspace_revision",
      currentMapRevision: "map-1",
      currentListingLedgerRevision: "ledger-2",
    });
    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-2");
    expect(getCurrentDb().state.snapshot.revision).toBe("map-1");
    expect(getCurrentDb().state.snapshot.mapState).toEqual(seedMapState);
  });

  test("returns stale when the map revision changes before reset commits", async () => {
    createRevisionMock.mockReturnValueOnce("map-3").mockReturnValueOnce("ledger-2");
    let transactionalLedgerRevisionAtSnapshotCas: string | null = null;
    getCurrentDb().hooks.beforeSnapshotUpdate = () => {
      getCurrentDb().state.snapshot = {
        ...getCurrentDb().state.snapshot,
        revision: "map-2",
        updatedAt: new Date("2026-06-23T12:01:00.000Z"),
      };
    };
    getCurrentDb().hooks.beforeSnapshotCasCheck = () => {
      transactionalLedgerRevisionAtSnapshotCas =
        getCurrentDb().transactionState.workspace.listingLedgerRevision;
    };

    const result = await resetWorkspace({
      workspaceId: "workspace-1",
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_workspace_revision",
      currentMapRevision: "map-2",
      currentListingLedgerRevision: "ledger-1",
    });
    expect(transactionalLedgerRevisionAtSnapshotCas).toBe("ledger-2");
    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-1");
    expect(getCurrentDb().state.snapshot.revision).toBe("map-2");
    expect(getCurrentDb().state.snapshot.mapState).toEqual(seedMapState);
  });
});

function getCurrentDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

function createWorkspaceStateDbMock() {
  let committedState = {
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: new Date("2026-06-23T12:00:00.000Z"),
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    },
    snapshot: {
      id: "snapshot-1",
      workspaceId: "workspace-1",
      revision: "map-1",
      mapState: structuredClone(seedMapState),
      createdAt: new Date("2026-06-23T12:00:00.000Z"),
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    },
    planningActions: [
      createPlanningAction("action-1", "mapProposal", "pending", "map-1"),
      createPlanningAction("action-2", "targetEdit", "pending", "map-1"),
      createPlanningAction("action-3", "mapProposal", "pending", "map-other"),
      {
        id: "action-4",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        messageId: "message-1",
        partIndex: 0,
        kind: "listingSave" as const,
        target: {
          kind: "listingLead" as const,
          resultSetId: "result-1",
          canonicalUrl: "https://example.com/listing-1",
          listingSnapshotHash: "hash-1",
          listingLedgerRevision: "ledger-1",
        },
        status: "pending" as const,
        error: null,
        failureKind: null,
        createdAt: new Date("2026-06-23T12:00:00.000Z"),
        updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      },
      {
        id: "action-other-workspace",
        workspaceId: "workspace-2",
        threadId: "thread-other",
        messageId: "message-other",
        partIndex: 0,
        kind: "listingSave" as const,
        target: {
          kind: "listingLead" as const,
          resultSetId: "result-other",
          canonicalUrl: "https://example.com/listing-other",
          listingSnapshotHash: "hash-other",
          listingLedgerRevision: "ledger-other",
        },
        status: "pending" as const,
        error: null,
        failureKind: null,
        createdAt: new Date("2026-06-23T12:00:00.000Z"),
        updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      },
    ],
    planningThreads: [
      createWorkspaceScopedRow("thread-1", "workspace-1"),
      createWorkspaceScopedRow("thread-other", "workspace-2"),
    ],
    planningMessages: [
      createWorkspaceScopedRow("message-1", "workspace-1"),
      createWorkspaceScopedRow("message-other", "workspace-2"),
    ],
    planningActionExecutions: [
      createWorkspaceScopedRow("execution-1", "workspace-1"),
      createWorkspaceScopedRow("execution-other", "workspace-2"),
    ],
    listingLeads: [
      createWorkspaceScopedRow("lead-1", "workspace-1"),
      createWorkspaceScopedRow("lead-other", "workspace-2"),
    ],
    geocodeCacheEntries: [
      createWorkspaceScopedRow("cache-1", "workspace-1"),
      createWorkspaceScopedRow("cache-other", "workspace-2"),
    ],
    facebookListingCaptures: [
      createWorkspaceScopedRow("capture-1", "workspace-1"),
      createWorkspaceScopedRow("capture-other", "workspace-2"),
    ],
  };
  const hooks: {
    beforeSnapshotUpdate?: (() => void) | undefined;
    beforeSnapshotCasCheck?: (() => void) | undefined;
    beforeWorkspaceUpdate?: (() => void) | undefined;
  } = {};
  let transactionalState = committedState;

  const tx = {
    query: {
      mapSnapshots: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(transactionalState.snapshot, where) ? transactionalState.snapshot : undefined,
      },
      workspaces: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(transactionalState.workspace, where) ? transactionalState.workspace : undefined,
      },
      planningActions: {
        findMany: async ({ where }: { where: unknown }) =>
          transactionalState.planningActions.filter((action) => matchesCondition(action, where)),
      },
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: unknown) {
              if (table === mapSnapshots) {
                const beforeSnapshotUpdate = hooks.beforeSnapshotUpdate;
                hooks.beforeSnapshotUpdate = undefined;

                if (beforeSnapshotUpdate) {
                  beforeSnapshotUpdate();
                  transactionalState = {
                    ...transactionalState,
                    snapshot: structuredClone(committedState.snapshot),
                  };
                }

                hooks.beforeSnapshotCasCheck?.();

                if (!matchesCondition(transactionalState.snapshot, condition)) {
                  return { returning: async () => [] };
                }

                transactionalState.snapshot = {
                  ...transactionalState.snapshot,
                  ...values,
                };

                return { returning: async () => [transactionalState.snapshot] };
              }

              if (table === workspaces) {
                const beforeWorkspaceUpdate = hooks.beforeWorkspaceUpdate;
                hooks.beforeWorkspaceUpdate = undefined;

                if (beforeWorkspaceUpdate) {
                  beforeWorkspaceUpdate();
                  transactionalState = {
                    ...transactionalState,
                    workspace: structuredClone(committedState.workspace),
                  };
                }

                if (!matchesCondition(transactionalState.workspace, condition)) {
                  return { returning: async () => [] };
                }

                transactionalState.workspace = {
                  ...transactionalState.workspace,
                  ...values,
                };

                return { returning: async () => [transactionalState.workspace] };
              }

              if (table === planningActions) {
                transactionalState.planningActions = transactionalState.planningActions.map((action) =>
                  matchesCondition(action, condition)
                    ? {
                        ...action,
                        ...values,
                      }
                    : action,
                );

                return Promise.resolve();
              }

              throw new Error("Unexpected table");
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(condition: unknown) {
          const rows = getTableRows(transactionalState, table);
          const nextRows = rows.filter((row) => !matchesCondition(row, condition));
          setTableRows(transactionalState, table, nextRows);
          return Promise.resolve();
        },
      };
    },
  };

  return {
    hooks,
    query: {
      mapSnapshots: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(committedState.snapshot, where) ? committedState.snapshot : undefined,
      },
      workspaces: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(committedState.workspace, where) ? committedState.workspace : undefined,
      },
      planningActions: {
        findMany: async ({ where }: { where: unknown }) =>
          committedState.planningActions.filter((action) => matchesCondition(action, where)),
      },
    },
    get state() {
      return committedState;
    },
    get transactionState() {
      return transactionalState;
    },
    async transaction<T>(callback: (innerTx: typeof tx) => Promise<T>) {
      transactionalState = structuredClone(committedState);

      try {
        const result = await callback(tx);
        committedState = transactionalState;
        return result;
      } catch (error) {
        throw error;
      } finally {
        transactionalState = committedState;
      }
    },
  };
}

function createWorkspaceScopedRow(id: string, workspaceId: string) {
  return { id, workspaceId };
}

function getTableRows(
  state: ReturnType<typeof createWorkspaceStateDbMock>["state"],
  table: unknown,
): Array<Record<string, unknown>> {
  if (table === planningActionExecutions) {
    return state.planningActionExecutions;
  }

  if (table === planningActions) {
    return state.planningActions;
  }

  if (table === planningMessages) {
    return state.planningMessages;
  }

  if (table === planningThreads) {
    return state.planningThreads;
  }

  if (table === listingLeads) {
    return state.listingLeads;
  }

  if (table === geocodeCacheEntries) {
    return state.geocodeCacheEntries;
  }

  if (table === facebookListingCaptures) {
    return state.facebookListingCaptures;
  }

  throw new Error("Unexpected delete table");
}

function setTableRows(
  state: ReturnType<typeof createWorkspaceStateDbMock>["state"],
  table: unknown,
  rows: Array<Record<string, unknown>>,
) {
  if (table === planningActionExecutions) {
    state.planningActionExecutions = rows as typeof state.planningActionExecutions;
    return;
  }

  if (table === planningActions) {
    state.planningActions = rows as typeof state.planningActions;
    return;
  }

  if (table === planningMessages) {
    state.planningMessages = rows as typeof state.planningMessages;
    return;
  }

  if (table === planningThreads) {
    state.planningThreads = rows as typeof state.planningThreads;
    return;
  }

  if (table === listingLeads) {
    state.listingLeads = rows as typeof state.listingLeads;
    return;
  }

  if (table === geocodeCacheEntries) {
    state.geocodeCacheEntries = rows as typeof state.geocodeCacheEntries;
    return;
  }

  if (table === facebookListingCaptures) {
    state.facebookListingCaptures = rows as typeof state.facebookListingCaptures;
    return;
  }

  throw new Error("Unexpected delete table");
}

function createPlanningAction(
  id: string,
  kind: "mapProposal" | "targetEdit",
  status: "pending" | "applied" | "dismissed" | "failed",
  mapRevision: string,
) {
  return {
    id,
    workspaceId: "workspace-1",
    threadId: "thread-1",
    messageId: "message-1",
    partIndex: 0,
    kind,
    target: {
      kind,
      messageId: "message-1",
      partIndex: 0,
      proposalHash: "hash-1",
      allowedOperationIndexes: [0],
      mapRevision,
    },
    status,
    error: null,
    failureKind: null,
    createdAt: new Date("2026-06-23T12:00:00.000Z"),
    updatedAt: new Date("2026-06-23T12:00:00.000Z"),
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
    values?: unknown[];
    conditions?: unknown[];
  };

  if (typedCondition.type === "and") {
    return (typedCondition.conditions ?? []).every((nested) => matchesCondition(record, nested));
  }

  if (typedCondition.type === "eq") {
    return readColumnValue(record, typedCondition.column) === typedCondition.value;
  }

  if (typedCondition.type === "inArray") {
    return (typedCondition.values ?? []).includes(readColumnValue(record, typedCondition.column));
  }

  return true;
}

function readColumnValue(record: Record<string, unknown>, column: unknown) {
  switch (column) {
    case mapSnapshots.id:
    case workspaces.id:
    case planningActions.id:
    case planningActionExecutions.id:
    case planningMessages.id:
    case planningThreads.id:
    case listingLeads.id:
    case geocodeCacheEntries.id:
    case facebookListingCaptures.id:
      return record.id;
    case mapSnapshots.workspaceId:
    case planningActionExecutions.workspaceId:
    case planningActions.workspaceId:
    case planningMessages.workspaceId:
    case planningThreads.workspaceId:
    case listingLeads.workspaceId:
    case geocodeCacheEntries.workspaceId:
    case facebookListingCaptures.workspaceId:
      return record.workspaceId;
    case mapSnapshots.revision:
      return record.revision;
    case workspaces.userId:
      return record.userId;
    case workspaces.listingLedgerRevision:
      return record.listingLedgerRevision;
    case planningActions.status:
      return record.status;
    case planningActions.kind:
      return record.kind;
    default:
      return undefined;
  }
}
