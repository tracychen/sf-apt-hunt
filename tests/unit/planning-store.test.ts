import { describe, expect, test, vi } from "vitest";

import { seedMapState } from "@/lib/map/seed-data";
import type { RedisPlanningClient } from "@/lib/server/planning/redis-store";
import {
  compareAndSetRedisMapSnapshot,
  createRedisPlanningStore,
  parsePersistedInstallation,
  parsePersistedMapSnapshot,
  parsePersistedPlanningThread,
  redisPlanningKey,
} from "@/lib/server/planning/redis-store";
import {
  hashInstallationSecret,
  verifyInstallationSecret,
} from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";
import type { PlanningStore } from "@/lib/server/planning/store";

describe("planning store", () => {
  test("hashes installation secrets without returning the raw secret", async () => {
    const hash = await hashInstallationSecret("secret-1");

    expect(hash).not.toBe("secret-1");
    await expect(verifyInstallationSecret("secret-1", hash)).resolves.toBe(true);
    await expect(verifyInstallationSecret("wrong", hash)).resolves.toBe(false);
  });

  test("creates a thread with a canonical map snapshot revision", async () => {
    const store = createMemoryPlanningStore();
    const result = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.thread.clientInstallationId).toBe("install-1");
      expect(result.mapSnapshot.mapState).toEqual(seedMapState);
      expect(result.mapSnapshot.revision).toMatch(/^map-rev-/);
      expect(result.listingLedgerRevision).toMatch(/^ledger-rev-/);
    }
  });

  test("reuses an existing installation only when the secret hash matches", async () => {
    const store = createMemoryPlanningStore();
    const matchingHash = await hashInstallationSecret("secret-1");
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: matchingHash,
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);

    const reused = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: matchingHash,
      initialMapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(reused.ok).toBe(true);
    if (reused.ok) {
      expect(reused.thread.id).not.toBe(created.ok ? created.thread.id : "");
    }
  });

  test("rejects existing installations with a different secret hash", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);

    const result = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-2"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("installation_secret_mismatch");
    }
  });

  test("verifies memory thread ownership from the stored installation secret hash", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      await expect(
        store.verifyThreadOwnership(created.thread.id, await hashInstallationSecret("secret-1")),
      ).resolves.toBe(true);
      await expect(
        store.verifyThreadOwnership(created.thread.id, await hashInstallationSecret("secret-2")),
      ).resolves.toBe(false);
    }
  });

  test("shares the fallback memory store across route module reloads", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.resetModules();
    const firstModule = await import("@/lib/server/planning/store");
    const secretHash = await hashInstallationSecret("secret-1");
    const created = await firstModule.getPlanningStore().createThread({
      clientInstallationId: "install-route-reload",
      clientInstallationSecretHash: secretHash,
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    vi.resetModules();
    const secondModule = await import("@/lib/server/planning/store");

    await expect(
      secondModule.getPlanningStore().verifyThreadOwnership(created.thread.id, secretHash),
    ).resolves.toBe(true);
  });

  test("rejects Redis installations with a different secret hash", async () => {
    const store = createRedisPlanningStore(createFakeRedisPlanningClient());
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);

    const result = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-2"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("installation_secret_mismatch");
    }
  });

  test("verifies Redis thread ownership and fails closed for invalid installation records", async () => {
    const redis = createFakeRedisPlanningClient();
    const store = createRedisPlanningStore(redis);
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      await expect(
        store.verifyThreadOwnership(created.thread.id, await hashInstallationSecret("secret-1")),
      ).resolves.toBe(true);
      await expect(
        store.verifyThreadOwnership(created.thread.id, await hashInstallationSecret("secret-2")),
      ).resolves.toBe(false);

      await redis
        .multi()
        .set(redisPlanningKey.installation("install-1"), { id: "install-1", threadIds: [] })
        .exec();

      await expect(
        store.verifyThreadOwnership(created.thread.id, await hashInstallationSecret("secret-1")),
      ).resolves.toBe(false);
    }
  });

  test("rejects stale map snapshot updates", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });
    expect(created.ok).toBe(true);

    const result = await store.updateMapSnapshot({
      threadId: created.ok ? created.thread.id : "missing-thread",
      expectedRevision: "wrong-revision",
      mapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("stale_map_revision");
    }
  });

  test("atomically compares and updates Redis map snapshots", async () => {
    const redis = createFakeRedisPlanningClient();
    const store = createRedisPlanningStore(redis);
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const missing = await compareAndSetRedisMapSnapshot(redis, {
      threadId: "missing-thread",
      expectedRevision: "map-rev-1",
      mapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });
    const stale = await compareAndSetRedisMapSnapshot(redis, {
      threadId: created.thread.id,
      expectedRevision: "wrong-revision",
      mapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });
    const ok = await compareAndSetRedisMapSnapshot(redis, {
      threadId: created.thread.id,
      expectedRevision: created.mapSnapshot.revision,
      mapState: {
        ...seedMapState,
        targets: [
          ...seedMapState.targets,
          {
            id: "target-scripted",
            name: "Scripted target",
            purpose: "fitness",
            coordinates: [-122.42, 37.77],
            priority: "high",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        ],
      },
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(missing).toEqual({ ok: false, error: "thread_not_found" });
    expect(stale).toEqual({ ok: false, error: "stale_map_revision" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.snapshot.revision).not.toBe(created.mapSnapshot.revision);
      expect(ok.snapshot.mapState.targets.some((target) => target.id === "target-scripted")).toBe(
        true,
      );
    }
  });

  test("rejects malformed Redis planning records at the persistence boundary", async () => {
    expect(parsePersistedPlanningThread({ id: "thread-1" })).toBeNull();
    expect(parsePersistedMapSnapshot({ id: "snapshot-1" })).toBeNull();
    expect(parsePersistedInstallation({ id: "install-1", threadIds: [] })).toBeNull();
  });

  test("claims Redis action execution idempotency before mutation", async () => {
    const store = createRedisPlanningStore(createFakeRedisPlanningClient());
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    await store.createAction({
      id: "action-claim-1",
      threadId: created.thread.id,
      messageId: "message-1",
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: "message-1",
        partIndex: 0,
        proposalHash: "proposal-hash",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-19T12:00:00.000Z",
    });

    await expect(
      store.claimActionExecution({
        actionId: "action-claim-1",
        idempotencyKey: "idem-claim-1",
        payloadHash: "payload-a",
        now: "2026-06-19T12:00:01.000Z",
      }),
    ).resolves.toEqual({ status: "claimed" });
    await expect(
      store.claimActionExecution({
        actionId: "action-claim-1",
        idempotencyKey: "idem-claim-1",
        payloadHash: "payload-a",
        now: "2026-06-19T12:00:02.000Z",
      }),
    ).resolves.toEqual({ status: "in_progress" });
    await expect(
      store.claimActionExecution({
        actionId: "action-claim-1",
        idempotencyKey: "idem-claim-1",
        payloadHash: "payload-b",
        now: "2026-06-19T12:00:03.000Z",
      }),
    ).resolves.toEqual({ status: "conflict" });
  });

  test("conditional action updates do not overwrite terminal actions", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    await store.createAction({
      id: "action-terminal-1",
      threadId: created.thread.id,
      messageId: "message-1",
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: "message-1",
        partIndex: 0,
        proposalHash: "proposal-hash",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-19T12:00:00.000Z",
    });
    const applied = await store.updateAction({
      actionId: "action-terminal-1",
      status: "applied",
      now: "2026-06-19T12:00:01.000Z",
    });

    expect(applied.ok).toBe(true);

    const failed = await store.updateAction({
      actionId: "action-terminal-1",
      status: "failed",
      now: "2026-06-19T12:00:02.000Z",
      error: "Map revision is stale.",
      failureKind: "retryable",
      onlyIfNotTerminal: true,
    });
    const action = await store.getAction("action-terminal-1");

    expect(failed).toEqual({ ok: false, error: "action_terminal" });
    expect(action?.status).toBe("applied");
    expect(action?.error).toBeUndefined();
  });

  test("memory store preserves a saved listing when the same canonical URL reappears", async () => {
    const store = createMemoryPlanningStore();

    await expectListingReappearanceMerge(store, "saved");
  });

  test("memory store preserves a dismissed listing when the same canonical URL reappears", async () => {
    const store = createMemoryPlanningStore();

    await expectListingReappearanceMerge(store, "dismissed");
  });

  test("redis store preserves a saved listing when the same canonical URL reappears", async () => {
    const store = createRedisPlanningStore(createFakeRedisPlanningClient());

    await expectListingReappearanceMerge(store, "saved");
  });

  test("redis store preserves a dismissed listing when the same canonical URL reappears", async () => {
    const store = createRedisPlanningStore(createFakeRedisPlanningClient());

    await expectListingReappearanceMerge(store, "dismissed");
  });

  test("reset deletes planning records even when the Redis thread index is missing", async () => {
    const redis = createFakeRedisPlanningClient();
    const store = createRedisPlanningStore(redis);
    const installationSecretHash = await hashInstallationSecret("secret-1");
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: installationSecretHash,
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "text", text: "Add Solidcore pins." }],
      now: "2026-06-19T12:00:01.000Z",
    });
    const action = await store.createAction({
      id: "action-reset-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: message.id,
        partIndex: 0,
        proposalHash: "proposal-hash-1",
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now: "2026-06-19T12:00:02.000Z",
    });
    const execution = await store.createExecution({
      actionId: action.id,
      idempotencyKey: "idem-reset-1",
      payloadHash: "payload-reset-1",
      status: "succeeded",
      now: "2026-06-19T12:00:03.000Z",
    });

    await redis
      .multi()
      .set(redisPlanningKey.threadIndex(created.thread.id), { threadId: created.thread.id })
      .exec();

    await expect(
      store.resetInstallation({
        clientInstallationId: "install-1",
        clientInstallationSecretHash: installationSecretHash,
      }),
    ).resolves.toEqual({ ok: true });

    await expect(store.getThread(created.thread.id)).resolves.toBeNull();
    await expect(store.getMessage(message.id)).resolves.toBeNull();
    await expect(store.getAction(action.id)).resolves.toBeNull();
    await expect(store.getExecution(execution.id)).resolves.toBeNull();
    await expect(
      store.getExecutionByIdempotencyKey(action.id, "idem-reset-1"),
    ).resolves.toBeNull();
  });
});

async function expectListingReappearanceMerge(
  store: PlanningStore,
  terminalStatus: "saved" | "dismissed",
) {
  const created = await store.createThread({
    clientInstallationId: "install-1",
    clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
    initialMapState: seedMapState,
    now: "2026-06-19T12:00:00.000Z",
  });

  expect(created.ok).toBe(true);
  if (!created.ok) {
    return;
  }

  const threadId = created.thread.id;
  const canonicalUrl = "https://example.com/listings/1";
  const firstSeenAt = "2026-06-19T12:00:00.000Z";
  const reappearedAt = "2026-06-19T12:05:00.000Z";

  await seedListingLeadForStore(store, {
    threadId,
    actionId: "listing-save-1",
    resultSetId: "results-1",
    candidate: createListingCandidate({
      id: "candidate-1",
      canonicalUrl,
      title: "Original listing title",
      priceMonthly: 2800,
    }),
    leadStatus: "seen",
    searchQuery: "studio under $3000",
    now: firstSeenAt,
    listingLedgerRevision: created.listingLedgerRevision,
  });

  const initialLead = await store.getListingLead(threadId, canonicalUrl);
  expect(initialLead?.status).toBe("seen");
  expect(initialLead?.firstSeenAt).toBe(firstSeenAt);
  expect(initialLead?.seenCount).toBe(1);

  const updatedLead = await store.updateListingLeadStatus({
    threadId,
    canonicalUrl,
    expectedRevision: created.listingLedgerRevision,
    status: terminalStatus,
    now: "2026-06-19T12:02:00.000Z",
  });

  expect(updatedLead.ok).toBe(true);
  if (!updatedLead.ok) {
    return;
  }

  await seedListingLeadForStore(store, {
    threadId,
    actionId: "listing-save-2",
    resultSetId: "results-2",
    candidate: createListingCandidate({
      id: "candidate-2",
      canonicalUrl,
      title: "Updated listing title",
      priceMonthly: 2950,
    }),
    leadStatus: "seen",
    searchQuery: "updated search query",
    now: reappearedAt,
    listingLedgerRevision: updatedLead.listingLedgerRevision,
  });

  const mergedLead = await store.getListingLead(threadId, canonicalUrl);

  expect(mergedLead).toMatchObject({
    canonicalUrl,
    firstSeenAt,
    lastSeenAt: reappearedAt,
    lastSearchQuery: "updated search query",
    seenCount: 2,
    status: terminalStatus,
    candidate: expect.objectContaining({
      id: "candidate-2",
      title: "Updated listing title",
      priceMonthly: 2950,
      url: canonicalUrl,
    }),
  });
}

async function seedListingLeadForStore(
  store: PlanningStore,
  input: {
    threadId: string;
    actionId: string;
    resultSetId: string;
    candidate: ReturnType<typeof createListingCandidate>;
    leadStatus: "seen";
    searchQuery: string;
    now: string;
    listingLedgerRevision: string;
  },
) {
  const lead = {
    canonicalUrl: input.candidate.url,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    lastSearchQuery: input.searchQuery,
    seenCount: 1,
    status: input.leadStatus,
    candidate: input.candidate,
  } as const;
  const message = await store.appendMessage({
    threadId: input.threadId,
    role: "assistant",
    parts: [
      {
        type: "listingResults",
        resultSetId: input.resultSetId,
        listings: [
          {
            lead,
            display: {
              ...input.candidate,
              canonicalUrl: input.candidate.url,
              leadStatus: input.leadStatus,
              firstSeenAt: input.now,
              lastSeenAt: input.now,
              seenCount: 1,
              planningScore: 4,
              planningSignals: [],
            },
            saveActionId: input.actionId,
            dismissActionId: `${input.actionId}-dismiss`,
          },
        ],
        sourceSummary: "One listing matched.",
        caveats: [],
        geocodeAuthorization: null,
      },
    ],
    now: input.now,
  });

  await store.createAction({
    id: input.actionId,
    threadId: input.threadId,
    messageId: message.id,
    partIndex: 0,
    kind: "listingSave",
    target: {
      kind: "listingLead",
      resultSetId: input.resultSetId,
      canonicalUrl: input.candidate.url,
      listingSnapshotHash: store.hashPayload(input.candidate),
      listingLedgerRevision: input.listingLedgerRevision,
    },
    now: input.now,
  });
}

function createListingCandidate(input: {
  id: string;
  canonicalUrl: string;
  title: string;
  priceMonthly: number;
}) {
  return {
    id: input.id,
    title: input.title,
    url: input.canonicalUrl,
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "1234 Fillmore St",
    geocodeQuery: "1234 Fillmore St, San Francisco, CA",
    locationConfidence: "medium" as const,
    coordinates: null,
    geocodeStatus: "not_attempted" as const,
    markerPrecision: "none" as const,
    priceMonthly: input.priceMonthly,
    beds: "studio" as const,
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 4 as const,
    whyItFits: "Close to Fillmore.",
    citations: [
      {
        url: input.canonicalUrl,
        title: input.title,
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };
}

function createFakeRedisPlanningClient(): RedisPlanningClient {
  const values = new Map<string, unknown>();

  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async incr(key) {
      const nextValue = Number(values.get(key) ?? 0) + 1;
      values.set(key, nextValue);
      return nextValue;
    },
    multi() {
      const writes: Array<[string, unknown]> = [];
      const transaction = {
        set(key: string, value: unknown) {
          writes.push([key, value]);
          return transaction;
        },
        async exec() {
          for (const [key, value] of writes) {
            values.set(key, value);
          }
          return null;
        },
      };

      return transaction;
    },
    createScript(script: string) {
      return {
        async eval(keys: string[], args: string[]) {
          if (script.includes('redis.call("KEYS", "sf-apt-hunt:planning:message:*")')) {
            const [threadId] = args;
            const matches = [...values.entries()]
              .filter(([key, value]) => {
                if (
                  !key.startsWith("sf-apt-hunt:planning:message:") ||
                  !value ||
                  typeof value !== "object" ||
                  !("threadId" in value)
                ) {
                  return false;
                }

                return value.threadId === threadId;
              })
              .map(([key]) => key);
            const actionIds = new Set(
              [...values.entries()]
                .filter(([key, value]) => {
                  if (
                    !key.startsWith("sf-apt-hunt:planning:action:") ||
                    !value ||
                    typeof value !== "object" ||
                    !("threadId" in value)
                  ) {
                    return false;
                  }

                  return value.threadId === threadId;
                })
                .map(([key, value]) => {
                  matches.push(key);
                  return value && typeof value === "object" && "id" in value ? String(value.id) : "";
                }),
            );

            for (const [key, value] of values.entries()) {
              if (
                key.startsWith("sf-apt-hunt:planning:execution:") &&
                value &&
                typeof value === "object" &&
                "actionId" in value &&
                actionIds.has(String(value.actionId))
              ) {
                matches.push(key);
              }

              if (!key.startsWith("sf-apt-hunt:planning:execution-by-idempotency:")) {
                continue;
              }

              const [, , , actionId] = key.split(":");
              if (actionIds.has(actionId)) {
                matches.push(key);
              }
            }

            return JSON.stringify(matches);
          }

          if (script.includes('redis.call("DEL", key)')) {
            for (const key of keys) {
              values.delete(key);
            }

            return JSON.stringify({ status: "ok" });
          }

          if (script.includes("claimRaw")) {
            const [claimKey, actionKey] = keys;
            const [payloadHash, actionId, idempotencyKey, now] = args;
            const claim = values.get(claimKey);

            if (typeof claim === "string") {
              return JSON.stringify({ status: "completed", executionId: claim });
            }

            if (claim && typeof claim === "object") {
              if (!("payloadHash" in claim) || claim.payloadHash !== payloadHash) {
                return JSON.stringify({ status: "conflict" });
              }

              if ("executionId" in claim && typeof claim.executionId === "string") {
                return JSON.stringify({ status: "completed", executionId: claim.executionId });
              }

              return JSON.stringify({ status: "in_progress" });
            }

            const action = values.get(actionKey);

            if (!action || typeof action !== "object") {
              return JSON.stringify({ status: "action_not_found" });
            }

            if (
              ("status" in action && (action.status === "applied" || action.status === "dismissed")) ||
              ("failureKind" in action && action.failureKind === "permanent")
            ) {
              return JSON.stringify({ status: "action_terminal" });
            }

            values.set(claimKey, {
              actionId,
              idempotencyKey,
              payloadHash,
              createdAt: now,
            });

            return JSON.stringify({ status: "claimed" });
          }

          if (script.includes("action.status = ARGV[2]")) {
            const [actionKey] = keys;
            const [onlyIfNotTerminal, status, now, error, failureKind] = args;
            const action = values.get(actionKey);

            if (!action || typeof action !== "object") {
              return JSON.stringify({ status: "action_not_found" });
            }

            if (
              onlyIfNotTerminal === "1" &&
              (("status" in action && (action.status === "applied" || action.status === "dismissed")) ||
                ("failureKind" in action && action.failureKind === "permanent"))
            ) {
              return JSON.stringify({ status: "action_terminal" });
            }

            const nextAction = {
              ...action,
              status,
              updatedAt: now,
              ...(error ? { error } : { error: undefined }),
              ...(failureKind ? { failureKind } : { failureKind: undefined }),
            };

            values.set(actionKey, nextAction);

            return JSON.stringify({ status: "ok", action: nextAction });
          }

          if (keys.length === 2) {
            const [ledgerKey, sequenceKey] = keys;
            const [expectedRevision, canonicalUrl, status, revisionPrefix] = args;
            const ledger = values.get(ledgerKey);

            if (!ledger || typeof ledger !== "object") {
              return JSON.stringify({ status: "missing" });
            }

            if (!("revision" in ledger) || ledger.revision !== expectedRevision) {
              return JSON.stringify({ status: "stale" });
            }

            if (!("leads" in ledger) || typeof ledger.leads !== "object" || !ledger.leads) {
              return JSON.stringify({ status: "lead_missing" });
            }

            const leads = ledger.leads as Record<string, unknown>;
            const lead = leads[canonicalUrl];

            if (!lead || typeof lead !== "object") {
              return JSON.stringify({ status: "lead_missing" });
            }

            if ("status" in lead && lead.status === "saved" && status === "dismissed") {
              return JSON.stringify({ status: "lead_missing" });
            }

            const sequence = Number(values.get(sequenceKey) ?? 0) + 1;
            const nextLead = { ...lead, status };
            const listingLedgerRevision = `${revisionPrefix}${sequence}`;

            values.set(sequenceKey, sequence);
            values.set(ledgerKey, {
              ...ledger,
              revision: listingLedgerRevision,
              leads: { ...leads, [canonicalUrl]: nextLead },
            });

            return JSON.stringify({ status: "ok", lead: nextLead, listingLedgerRevision });
          }

          const [snapshotKey, threadKey, sequenceKey] = keys;
          const [expectedRevision, mapStateJson, revisionPrefix, now] = args;
          const current = values.get(snapshotKey);

          if (!current || typeof current !== "object") {
            return JSON.stringify({ status: "missing" });
          }

          if (!("revision" in current) || current.revision !== expectedRevision) {
            return JSON.stringify({ status: "stale" });
          }

          const sequence = Number(values.get(sequenceKey) ?? 0) + 1;
          const snapshot = {
            ...current,
            mapState: JSON.parse(mapStateJson) as unknown,
            revision: `${revisionPrefix}${sequence}`,
            updatedAt: now,
          };
          const thread = values.get(threadKey);

          values.set(sequenceKey, sequence);
          values.set(snapshotKey, snapshot);

          if (thread && typeof thread === "object") {
            values.set(threadKey, { ...thread, updatedAt: now });
          }

          return JSON.stringify({ status: "ok", snapshot });
        },
      };
    },
  };
}
