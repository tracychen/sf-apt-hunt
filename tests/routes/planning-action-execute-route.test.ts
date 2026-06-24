import { beforeEach, describe, expect, test, vi } from "vitest";

import type { MapPatchProposal } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { POST } from "@/app/api/planning/actions/execute/route";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";
import type { PlanningStore } from "@/lib/server/planning/store";

const planningStoreMock = vi.hoisted(() => ({
  current: undefined as PlanningStore | undefined,
}));
const workspacePlanningStoresMock = vi.hoisted(() => ({
  current: new Map<string, PlanningStore>(),
}));
const sessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));
const workspaceMock = vi.hoisted(() => ({
  id: "workspace-1",
}));

vi.mock("@/lib/server/planning/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/planning/store")>();

  return {
    ...actual,
    getPlanningStore: () => {
      if (!planningStoreMock.current) {
        throw new Error("Planning store mock was not initialized.");
      }

      return planningStoreMock.current;
    },
    getPlanningStoreForWorkspace: (workspaceId: string) => {
      const store = workspacePlanningStoresMock.current.get(workspaceId);

      if (!store) {
        throw new Error(`Workspace planning store mock was not initialized for ${workspaceId}.`);
      }

      return store;
    },
  };
});

vi.mock("@/lib/server/auth/session", () => ({
  getCurrentUserId: async () => sessionMock.userId,
}));

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async (userId: string) => ({
    workspace: {
      id: workspaceMock.id,
      userId,
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: new Date("2026-06-23T12:00:00.000Z"),
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    },
    mapSnapshot: {
      id: "snapshot-1",
      workspaceId: workspaceMock.id,
      revision: "map-1",
      mapState: seedMapState,
      createdAt: new Date("2026-06-23T12:00:00.000Z"),
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
    },
  }),
}));

function createRequest(body: unknown) {
  return new Request("http://localhost/api/planning/actions/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sf-apt-installation-secret": "secret-1",
    },
    body: JSON.stringify(body),
  });
}

function createRequestWithHeaders(body: unknown, headers: Record<string, string>) {
  return new Request("http://localhost/api/planning/actions/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createRequestWithSecret(body: unknown, installationSecret: string) {
  return createRequestWithHeaders(body, {
    "x-sf-apt-installation-secret": installationSecret,
  });
}

describe("POST /api/planning/actions/execute", () => {
  beforeEach(() => {
    planningStoreMock.current = createMemoryPlanningStore();
    workspacePlanningStoresMock.current = new Map();
    sessionMock.userId = null;
    workspaceMock.id = "workspace-1";
  });

  test("rejects requests without installation secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/planning/actions/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("rejects listing save payloads with client-supplied canonicalUrl", async () => {
    const response = await POST(
      createRequest({
        threadId: "thread-1",
        actionId: "action-1",
        idempotencyKey: "idem-1",
        payload: {
          kind: "listingSave",
          canonicalUrl: "https://example.com/listing/1",
          expectedListingLedgerRevision: "ledger-rev-1",
          expectedListingSnapshotHash: "snapshot-hash-1",
        },
      }),
    );

    expect(response.status).toBe(400);
  });

  test("rejects action execution when the installation secret does not own the thread", async () => {
    const setup = await createMapProposalAction("owned-action-1");

    const response = await POST(
      createRequestWithSecret(
        {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-1",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: setup.mapRevision,
          },
        },
        "secret-2",
      ),
    );

    const action = await getTestStore().getAction(setup.actionId);

    expect(response.status).toBe(403);
    expect(action?.status).toBe("pending");
  });

  test("signed-in action execution rejects actions from a different workspace", async () => {
    sessionMock.userId = "user-1";
    workspacePlanningStoresMock.current.set(
      "workspace-1",
      createWorkspacePlanningStore("workspace-1"),
    );
    workspacePlanningStoresMock.current.set(
      "workspace-2",
      createWorkspacePlanningStore("workspace-2"),
    );
    const setup = await createWorkspaceMapProposalAction("workspace-1", "workspace-action-1");
    workspaceMock.id = "workspace-2";

    const response = await POST(
      new Request("http://localhost/api/planning/actions/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-workspace-1",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: setup.mapRevision,
          },
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Planning action is not owned by this workspace.",
    });
  });

  test("signed-in action execution succeeds without installation secret headers", async () => {
    sessionMock.userId = "user-1";
    workspacePlanningStoresMock.current.set(
      "workspace-1",
      createWorkspacePlanningStore("workspace-1"),
    );
    const setup = await createWorkspaceMapProposalAction("workspace-1", "workspace-action-allow-1");

    const response = await POST(
      createRequestWithHeaders(
        {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-workspace-allow-1",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: setup.mapRevision,
          },
        },
        {},
      ),
    );
    const body = await response.json();
    const action = await getWorkspaceStore("workspace-1").getAction(setup.actionId);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.execution.status).toBe("succeeded");
    expect(action?.status).toBe("applied");
  });

  test("signed-in action execution rejects cross-site requests", async () => {
    sessionMock.userId = "user-1";
    workspacePlanningStoresMock.current.set(
      "workspace-1",
      createWorkspacePlanningStore("workspace-1"),
    );
    const setup = await createWorkspaceMapProposalAction("workspace-1", "workspace-action-csrf-1");

    const response = await POST(
      createRequestWithHeaders(
        {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-workspace-csrf-1",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: setup.mapRevision,
          },
        },
        {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Forbidden origin.",
    });
  });

  test("unsigned action execution preserves installation-secret access for cross-site requests", async () => {
    const setup = await createMapProposalAction("owned-action-csrf-allow-1");

    const response = await POST(
      createRequestWithHeaders(
        {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-cross-site-allowed-1",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: setup.mapRevision,
          },
        },
        {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "x-sf-apt-installation-secret": "secret-1",
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.execution.status).toBe("succeeded");
  });
});

async function createMapProposalAction(actionId: string) {
  const store = getTestStore();
  const created = await store.createThread({
    clientInstallationId: "install-1",
    clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
    initialMapState: seedMapState,
    now: "2026-06-19T12:00:00.000Z",
  });

  if (!created.ok) {
    throw new Error(`Failed to create thread: ${created.error}`);
  }

  const proposal: MapPatchProposal = {
    summary: "Add one target",
    confidence: "high",
    requiresUserReview: true,
    operations: [
      {
        type: "addTarget",
        target: {
          id: "target-test",
          name: "Test target",
          purpose: "fitness",
          coordinates: [-122.42, 37.77],
          priority: "high",
          influence: "positive",
          radiusMinutes: 10,
          notes: [],
        },
      },
    ],
  };
  const message = await store.appendMessage({
    threadId: created.thread.id,
    role: "assistant",
    parts: [{ type: "mapProposal", actionId, proposal, researchSummary: null }],
    now: "2026-06-19T12:00:00.000Z",
  });
  await store.createAction({
    id: actionId,
    threadId: created.thread.id,
    messageId: message.id,
    partIndex: 0,
    kind: "mapProposal",
    target: {
      kind: "mapProposal",
      messageId: message.id,
      partIndex: 0,
      proposalHash: store.hashPayload(proposal),
      allowedOperationIndexes: [0],
      mapRevision: created.mapSnapshot.revision,
    },
    now: "2026-06-19T12:00:00.000Z",
  });

  return {
    actionId,
    mapRevision: created.mapSnapshot.revision,
    threadId: created.thread.id,
  };
}

function getTestStore() {
  if (!planningStoreMock.current) {
    throw new Error("Planning store mock was not initialized.");
  }

  return planningStoreMock.current;
}

function getWorkspaceStore(workspaceId: string) {
  const store = workspacePlanningStoresMock.current.get(workspaceId);

  if (!store) {
    throw new Error(`Workspace planning store mock was not initialized for ${workspaceId}.`);
  }

  return store;
}

function createWorkspacePlanningStore(workspaceId: string): PlanningStore {
  const baseStore = createMemoryPlanningStore();
  const workspaceInstallationSecretHash = "workspace-mode-secret-hash";

  return {
    ...baseStore,
    async createThread(input) {
      return baseStore.createThread({
        ...input,
        clientInstallationId: workspaceId,
        clientInstallationSecretHash: workspaceInstallationSecretHash,
      });
    },
    async resetInstallation() {
      return baseStore.resetInstallation({
        clientInstallationId: workspaceId,
        clientInstallationSecretHash: workspaceInstallationSecretHash,
      });
    },
    async verifyThreadOwnership(threadId) {
      const thread = await baseStore.getThread(threadId);

      return thread?.clientInstallationId === workspaceId;
    },
  };
}

async function createWorkspaceMapProposalAction(workspaceId: string, actionId: string) {
  const store = getWorkspaceStore(workspaceId);
  const created = await store.createThread({
    clientInstallationId: workspaceId,
    clientInstallationSecretHash: "unused",
    initialMapState: seedMapState,
    now: "2026-06-19T12:00:00.000Z",
  });

  if (!created.ok) {
    throw new Error(`Failed to create thread: ${created.error}`);
  }

  const proposal: MapPatchProposal = {
    summary: "Add one target",
    confidence: "high",
    requiresUserReview: true,
    operations: [
      {
        type: "addTarget",
        target: {
          id: "target-test",
          name: "Test target",
          purpose: "fitness",
          coordinates: [-122.42, 37.77],
          priority: "high",
          influence: "positive",
          radiusMinutes: 10,
          notes: [],
        },
      },
    ],
  };
  const message = await store.appendMessage({
    threadId: created.thread.id,
    role: "assistant",
    parts: [{ type: "mapProposal", actionId, proposal, researchSummary: null }],
    now: "2026-06-19T12:00:00.000Z",
  });
  await store.createAction({
    id: actionId,
    threadId: created.thread.id,
    messageId: message.id,
    partIndex: 0,
    kind: "mapProposal",
    target: {
      kind: "mapProposal",
      messageId: message.id,
      partIndex: 0,
      proposalHash: store.hashPayload(proposal),
      allowedOperationIndexes: [0],
      mapRevision: created.mapSnapshot.revision,
    },
    now: "2026-06-19T12:00:00.000Z",
  });

  return {
    actionId,
    mapRevision: created.mapSnapshot.revision,
    threadId: created.thread.id,
  };
}
