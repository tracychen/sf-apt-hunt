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
  };
});

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

function createRequestWithSecret(body: unknown, installationSecret: string) {
  return new Request("http://localhost/api/planning/actions/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sf-apt-installation-secret": installationSecret,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/planning/actions/execute", () => {
  beforeEach(() => {
    planningStoreMock.current = createMemoryPlanningStore();
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
