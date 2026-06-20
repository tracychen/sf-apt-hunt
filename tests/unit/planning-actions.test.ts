import { describe, expect, test } from "vitest";

import type { ListingCandidate, ListingLead, MapPatchProposal } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { executePlanningAction } from "@/lib/server/planning/actions";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";

const now = "2026-06-19T12:00:00.000Z";

describe("executePlanningAction", () => {
  test("applies a stored map proposal subset and advances the map revision", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now,
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
      parts: [{ type: "mapProposal", actionId: "action-1", proposal, researchSummary: null }],
      now,
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
        proposalHash: store.hashPayload(proposal),
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now,
    });

    const result = await executePlanningAction({
      store,
      now: "2026-06-19T12:01:00.000Z",
      request: {
        threadId: created.thread.id,
        actionId: "action-1",
        idempotencyKey: "idem-1",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: created.mapSnapshot.revision,
        },
      },
    });

    expect(result.action.status).toBe("applied");
    expect(result.mapSnapshot?.mapState.targets.some((target) => target.id === "target-test")).toBe(
      true,
    );
  });

  test("replays matching idempotency keys before terminal-state rejection", async () => {
    const setup = await createMapProposalAction();

    const first = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:01:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: setup.actionId,
        idempotencyKey: "idem-1",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: setup.mapRevision,
        },
      },
    });
    const second = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:02:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: setup.actionId,
        idempotencyKey: "idem-1",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: setup.mapRevision,
        },
      },
    });

    expect(second.execution.id).toBe(first.execution.id);
    expect(second.action.status).toBe("applied");
  });

  test("rejects an in-progress matching idempotency key before mutating state", async () => {
    const setup = await createMapProposalAction({ actionId: "action-in-progress" });
    const payload = {
      kind: "mapProposal" as const,
      operationIndexes: [0],
      expectedMapRevision: setup.mapRevision,
    };

    await setup.store.claimActionExecution({
      actionId: setup.actionId,
      idempotencyKey: "idem-in-progress",
      payloadHash: setup.store.hashPayload(payload),
      now: "2026-06-19T12:00:30.000Z",
    });

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-in-progress",
          payload,
        },
      }),
    ).rejects.toThrow("idempotency_in_progress");

    const action = await setup.store.getAction(setup.actionId);
    const snapshot = await setup.store.getMapSnapshot(setup.threadId);

    expect(action?.status).toBe("pending");
    expect(snapshot?.mapState.targets.some((target) => target.id === "target-test")).toBe(false);
  });

  test("rejects conflicting idempotency payloads before mutating state", async () => {
    const setup = await createMapProposalAction({ actionId: "action-idempotency-conflict" });

    await setup.store.claimActionExecution({
      actionId: setup.actionId,
      idempotencyKey: "idem-conflict",
      payloadHash: setup.store.hashPayload({
        kind: "mapProposal",
        operationIndexes: [0],
        expectedMapRevision: setup.mapRevision,
      }),
      now: "2026-06-19T12:00:30.000Z",
    });

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-conflict",
          payload: {
            kind: "mapProposal",
            operationIndexes: [],
            expectedMapRevision: setup.mapRevision,
          },
        },
      }),
    ).rejects.toThrow("idempotency_conflict");

    const action = await setup.store.getAction(setup.actionId);
    const snapshot = await setup.store.getMapSnapshot(setup.threadId);

    expect(action?.status).toBe("pending");
    expect(snapshot?.mapState.targets.some((target) => target.id === "target-test")).toBe(false);
  });

  test("records and replays a failed map proposal execution", async () => {
    const setup = await createMapProposalAction({
      actionId: "action-fails",
      operations: [
        {
          type: "updateTargetPriority",
          targetId: "missing-target",
          priority: "high",
          reason: "Exercise anchor matters.",
        },
      ],
    });

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-failed",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: setup.mapRevision,
          },
        },
      }),
    ).rejects.toThrow("Unknown target ID.");

    const failedExecution = await setup.store.getExecutionByIdempotencyKey(
      setup.actionId,
      "idem-failed",
    );
    const failedAction = await setup.store.getAction(setup.actionId);

    expect(failedExecution?.status).toBe("failed");
    expect(failedExecution?.payloadHash).toBe(
      setup.store.hashPayload({
        kind: "mapProposal",
        operationIndexes: [0],
        expectedMapRevision: setup.mapRevision,
      }),
    );
    expect(failedExecution?.error).toBe("Unknown target ID.");
    expect(failedAction?.status).toBe("failed");
    expect(failedAction?.failureKind).toBe("permanent");

    const replay = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:02:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: setup.actionId,
        idempotencyKey: "idem-failed",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: setup.mapRevision,
        },
      },
    });

    expect(replay.execution.id).toBe(failedExecution?.id);
    expect(replay.execution.status).toBe("failed");
    expect(replay.action.failureKind).toBe("permanent");
  });

  test("rejects map proposal execution when the request revision differs from the stored target revision", async () => {
    const setup = await createMapProposalAction({ actionId: "action-stale-target" });
    const advancedSnapshot = await setup.store.updateMapSnapshot({
      threadId: setup.threadId,
      expectedRevision: setup.mapRevision,
      mapState: seedMapState,
      now: "2026-06-19T12:00:30.000Z",
    });

    expect(advancedSnapshot.ok).toBe(true);

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-stale-target",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0],
            expectedMapRevision: advancedSnapshot.ok
              ? advancedSnapshot.snapshot.revision
              : "map-rev-new",
          },
        },
      }),
    ).rejects.toThrow("stale_map_revision");

    const action = await setup.store.getAction(setup.actionId);
    const snapshot = await setup.store.getMapSnapshot(setup.threadId);

    expect(action?.status).toBe("failed");
    expect(snapshot?.mapState.targets.some((target) => target.id === "target-test")).toBe(false);
  });

  test("rejects requested operation indexes outside the stored allowed set", async () => {
    const setup = await createMapProposalAction({
      actionId: "action-unallowed-index",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "target-allowed",
            name: "Allowed target",
            purpose: "fitness",
            coordinates: [-122.42, 37.77],
            priority: "high",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        },
        {
          type: "addTarget",
          target: {
            id: "target-unallowed",
            name: "Unallowed target",
            purpose: "transit",
            coordinates: [-122.41, 37.78],
            priority: "medium",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        },
      ],
      allowedOperationIndexes: [0],
    });

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-unallowed-index",
          payload: {
            kind: "mapProposal",
            operationIndexes: [0, 1],
            expectedMapRevision: setup.mapRevision,
          },
        },
      }),
    ).rejects.toThrow("Requested proposal operation is not allowed.");

    const snapshot = await setup.store.getMapSnapshot(setup.threadId);

    expect(snapshot?.mapState.targets.some((target) => target.id === "target-allowed")).toBe(false);
    expect(snapshot?.mapState.targets.some((target) => target.id === "target-unallowed")).toBe(false);
  });

  test("applies a listing lifecycle action when the snapshot hash matches the stored target", async () => {
    const setup = await createListingSaveAction();

    const result = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:01:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: setup.actionId,
        idempotencyKey: "idem-listing-save",
        payload: {
          kind: "listingSave",
          expectedListingLedgerRevision: setup.listingLedgerRevision,
          expectedListingSnapshotHash: setup.listingSnapshotHash,
        },
      },
    });

    expect(result.action.status).toBe("applied");
    expect(result.listingLead?.status).toBe("saved");
  });

  test("rejects listing lifecycle execution when the request snapshot hash differs from the stored target hash", async () => {
    const setup = await createListingSaveAction();

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: setup.actionId,
          idempotencyKey: "idem-listing-snapshot-mismatch",
          payload: {
            kind: "listingSave",
            expectedListingLedgerRevision: setup.listingLedgerRevision,
            expectedListingSnapshotHash: "different-snapshot-hash",
          },
        },
      }),
    ).rejects.toThrow("listing_snapshot_mismatch");

    const action = await setup.store.getAction(setup.actionId);
    const followUp = await setup.store.updateListingLeadStatus({
      threadId: setup.threadId,
      canonicalUrl: setup.canonicalUrl,
      expectedRevision: setup.listingLedgerRevision,
      status: "saved",
      now: "2026-06-19T12:01:30.000Z",
    });

    expect(action?.status).toBe("failed");
    expect(followUp.ok).toBe(true);
    expect(followUp.ok ? followUp.lead.status : null).toBe("saved");
  });

  test("executes two listing actions from the same result set using the current ledger revision", async () => {
    const setup = await createListingResultSetActions();

    const saved = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:01:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: "listing-save-1",
        idempotencyKey: "idem-listing-save-1",
        payload: {
          kind: "listingSave",
          expectedListingLedgerRevision: setup.listingLedgerRevision,
          expectedListingSnapshotHash: setup.listingSnapshotHashes[0],
        },
      },
    });

    expect(saved.listingLead?.status).toBe("saved");
    expect(saved.listingLedgerRevision).not.toBe(setup.listingLedgerRevision);

    const dismissed = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:02:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: "listing-dismiss-2",
        idempotencyKey: "idem-listing-dismiss-2",
        payload: {
          kind: "listingDismiss",
          expectedListingLedgerRevision: saved.listingLedgerRevision ?? "missing-ledger-revision",
          expectedListingSnapshotHash: setup.listingSnapshotHashes[1],
        },
      },
    });

    expect(dismissed.listingLead?.canonicalUrl).toBe("https://example.com/listing/2");
    expect(dismissed.listingLead?.status).toBe("dismissed");
  });

  test("rejects listing lifecycle execution when the client ledger revision is stale", async () => {
    const setup = await createListingResultSetActions();
    const advancedLedger = await setup.store.updateListingLeadStatus({
      threadId: setup.threadId,
      canonicalUrl: setup.canonicalUrls[0],
      expectedRevision: setup.listingLedgerRevision,
      status: "saved",
      now: "2026-06-19T12:00:30.000Z",
    });

    expect(advancedLedger.ok).toBe(true);

    await expect(
      executePlanningAction({
        store: setup.store,
        now: "2026-06-19T12:01:00.000Z",
        request: {
          threadId: setup.threadId,
          actionId: "listing-dismiss-2",
          idempotencyKey: "idem-stale-listing",
          payload: {
            kind: "listingDismiss",
            expectedListingLedgerRevision: setup.listingLedgerRevision,
            expectedListingSnapshotHash: setup.listingSnapshotHashes[1],
          },
        },
      }),
    ).rejects.toThrow("stale_listing_ledger_revision");

    const action = await setup.store.getAction("listing-dismiss-2");

    expect(action?.status).toBe("failed");
    expect(action?.failureKind).toBe("retryable");
  });
});

async function createMapProposalAction(options: {
  actionId?: string;
  operations?: MapPatchProposal["operations"];
  allowedOperationIndexes?: number[];
} = {}) {
  const store = createMemoryPlanningStore();
  const created = await store.createThread({
    clientInstallationId: "install-1",
    clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
    initialMapState: seedMapState,
    now,
  });

  if (!created.ok) {
    throw new Error(`Failed to create thread: ${created.error}`);
  }

  const proposal: MapPatchProposal = {
    summary: "Add one target",
    confidence: "high",
    requiresUserReview: true,
    operations: options.operations ?? [
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
  const actionId = options.actionId ?? "action-1";
  const message = await store.appendMessage({
    threadId: created.thread.id,
    role: "assistant",
    parts: [{ type: "mapProposal", actionId, proposal, researchSummary: null }],
    now,
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
      allowedOperationIndexes: options.allowedOperationIndexes ?? [0],
      mapRevision: created.mapSnapshot.revision,
    },
    now,
  });

  return {
    actionId,
    mapRevision: created.mapSnapshot.revision,
    store,
    threadId: created.thread.id,
  };
}

async function createListingSaveAction() {
  const store = createMemoryPlanningStore();
  const created = await store.createThread({
    clientInstallationId: "install-1",
    clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
    initialMapState: seedMapState,
    now,
  });

  if (!created.ok) {
    throw new Error(`Failed to create thread: ${created.error}`);
  }

  const canonicalUrl = "https://example.com/listing/1";
  const candidate: ListingCandidate = {
    id: "listing-1",
    title: "Sunny studio",
    url: canonicalUrl,
    sourceDomain: "example.com",
    neighborhoodGuess: "Hayes Valley",
    locationText: "Hayes Valley",
    geocodeQuery: "Hayes Valley, San Francisco",
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2400,
    beds: "studio",
    shortTermSignal: true,
    furnishedSignal: true,
    fitScore: 4,
    whyItFits: "Short term furnished studio near transit.",
    citations: [{ url: canonicalUrl, title: "Sunny studio", sourceDomain: "example.com" }],
    caveats: [],
  };
  const lead: ListingLead = {
    canonicalUrl,
    firstSeenAt: now,
    lastSeenAt: now,
    lastSearchQuery: "studio",
    seenCount: 1,
    status: "new",
    candidate,
  };
  const listingSnapshotHash = store.hashPayload(candidate);
  const message = await store.appendMessage({
    threadId: created.thread.id,
    role: "assistant",
    parts: [
      {
        type: "listingResults",
        resultSetId: "results-1",
        listings: [
          {
            lead,
            display: {
              ...candidate,
              canonicalUrl,
              leadStatus: "new",
              firstSeenAt: now,
              lastSeenAt: now,
              seenCount: 1,
              planningScore: 4,
              planningSignals: [],
            },
            saveActionId: "listing-save-1",
            dismissActionId: "listing-dismiss-1",
          },
        ],
        sourceSummary: "One listing.",
        caveats: [],
        geocodeAuthorization: null,
      },
    ],
    now,
  });
  await store.createAction({
    id: "listing-save-1",
    threadId: created.thread.id,
    messageId: message.id,
    partIndex: 0,
    kind: "listingSave",
    target: {
      kind: "listingLead",
      resultSetId: "results-1",
      canonicalUrl,
      listingSnapshotHash,
      listingLedgerRevision: created.listingLedgerRevision,
    },
    now,
  });

  return {
    actionId: "listing-save-1",
    canonicalUrl,
    listingLedgerRevision: created.listingLedgerRevision,
    listingSnapshotHash,
    store,
    threadId: created.thread.id,
  };
}

async function createListingResultSetActions() {
  const store = createMemoryPlanningStore();
  const created = await store.createThread({
    clientInstallationId: "install-1",
    clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
    initialMapState: seedMapState,
    now,
  });

  if (!created.ok) {
    throw new Error(`Failed to create thread: ${created.error}`);
  }

  const candidates = [
    createListingCandidate("listing-1", "https://example.com/listing/1"),
    createListingCandidate("listing-2", "https://example.com/listing/2"),
  ];
  const leads: ListingLead[] = candidates.map((candidate) => ({
    canonicalUrl: candidate.url,
    firstSeenAt: now,
    lastSeenAt: now,
    lastSearchQuery: "studio",
    seenCount: 1,
    status: "new",
    candidate,
  }));
  const message = await store.appendMessage({
    threadId: created.thread.id,
    role: "assistant",
    parts: [
      {
        type: "listingResults",
        resultSetId: "results-1",
        listings: leads.map((lead, index) => ({
          lead,
          display: {
            ...lead.candidate,
            canonicalUrl: lead.canonicalUrl,
            leadStatus: "new",
            firstSeenAt: now,
            lastSeenAt: now,
            seenCount: 1,
            planningScore: 4,
            planningSignals: [],
          },
          saveActionId: `listing-save-${index + 1}`,
          dismissActionId: `listing-dismiss-${index + 1}`,
        })),
        sourceSummary: "Two listings.",
        caveats: [],
        geocodeAuthorization: null,
      },
    ],
    now,
  });

  for (const [index, lead] of leads.entries()) {
    await store.createAction({
      id: `listing-save-${index + 1}`,
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "listingSave",
      target: {
        kind: "listingLead",
        resultSetId: "results-1",
        canonicalUrl: lead.canonicalUrl,
        listingSnapshotHash: store.hashPayload(lead.candidate),
        listingLedgerRevision: created.listingLedgerRevision,
      },
      now,
    });
    await store.createAction({
      id: `listing-dismiss-${index + 1}`,
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "listingDismiss",
      target: {
        kind: "listingLead",
        resultSetId: "results-1",
        canonicalUrl: lead.canonicalUrl,
        listingSnapshotHash: store.hashPayload(lead.candidate),
        listingLedgerRevision: created.listingLedgerRevision,
      },
      now,
    });
  }

  return {
    canonicalUrls: leads.map((lead) => lead.canonicalUrl),
    listingLedgerRevision: created.listingLedgerRevision,
    listingSnapshotHashes: leads.map((lead) => store.hashPayload(lead.candidate)),
    store,
    threadId: created.thread.id,
  };
}

function createListingCandidate(id: string, canonicalUrl: string): ListingCandidate {
  return {
    id,
    title: "Sunny studio",
    url: canonicalUrl,
    sourceDomain: "example.com",
    neighborhoodGuess: "Hayes Valley",
    locationText: "Hayes Valley",
    geocodeQuery: "Hayes Valley, San Francisco",
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2400,
    beds: "studio",
    shortTermSignal: true,
    furnishedSignal: true,
    fitScore: 4,
    whyItFits: "Short term furnished studio near transit.",
    citations: [{ url: canonicalUrl, title: "Sunny studio", sourceDomain: "example.com" }],
    caveats: [],
  };
}
