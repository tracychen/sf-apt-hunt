import { createHash } from "node:crypto";

import { Redis } from "@upstash/redis";
import { z } from "zod";

import {
  listingLeadSchema,
  mapSnapshotSchema,
  planningActionExecutionRecordSchema,
  planningActionRecordSchema,
  planningContextSummarySchema,
  planningMessageSchema,
  planningThreadSchema,
} from "@/lib/domain/schemas";
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

const planningKey = {
  thread: (threadId: string) => `sf-apt-hunt:planning:thread:${threadId}`,
  message: (messageId: string) => `sf-apt-hunt:planning:message:${messageId}`,
  action: (actionId: string) => `sf-apt-hunt:planning:action:${actionId}`,
  execution: (executionId: string) => `sf-apt-hunt:planning:execution:${executionId}`,
  executionByIdempotencyKey: (actionId: string, idempotencyKey: string) =>
    `sf-apt-hunt:planning:execution-by-idempotency:${actionId}:${idempotencyKey}`,
  mapSnapshot: (threadId: string) => `sf-apt-hunt:planning:map-snapshot:${threadId}`,
  listingLedger: (threadId: string) => `sf-apt-hunt:planning:listing-ledger:${threadId}`,
  preferenceMemory: (threadId: string) => `sf-apt-hunt:planning:preference-memory:${threadId}`,
  threadIndex: (threadId: string) => `sf-apt-hunt:planning:thread-index:${threadId}`,
  installation: (installationId: string) =>
    `sf-apt-hunt:planning:installation:${installationId}`,
  sequence: "sf-apt-hunt:planning:sequence",
};

type StoredInstallation = {
  id: string;
  secretHash: string;
  threadIds: string[];
};

type StoredListingLedger = {
  threadId: string;
  revision: string;
  leads: Record<string, ListingLead>;
};

type StoredActionExecutionClaim = {
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  createdAt: string;
  executionId?: string;
};

type StoredThreadIndex = {
  threadId: string;
  messageIds: string[];
  actionIds: string[];
  executionIds: string[];
  executionClaimKeys: string[];
};

type RedisPlanningTransaction = {
  set(key: string, value: unknown): RedisPlanningTransaction;
  exec(): Promise<unknown>;
};

type RedisPlanningScript = {
  eval(keys: string[], args: string[]): Promise<unknown>;
};

export type RedisPlanningClient = {
  get(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  multi(): RedisPlanningTransaction;
  createScript(script: string): RedisPlanningScript;
};

const compareAndSetMapSnapshotScript = `
local snapshotRaw = redis.call("GET", KEYS[1])
if not snapshotRaw then
  return cjson.encode({ status = "missing" })
end

local snapshot = cjson.decode(snapshotRaw)
if snapshot.revision ~= ARGV[1] then
  return cjson.encode({ status = "stale" })
end

local sequence = redis.call("INCR", KEYS[3])
snapshot.mapState = cjson.decode(ARGV[2])
snapshot.revision = ARGV[3] .. sequence
snapshot.updatedAt = ARGV[4]
redis.call("SET", KEYS[1], cjson.encode(snapshot))

local threadRaw = redis.call("GET", KEYS[2])
if threadRaw then
  local thread = cjson.decode(threadRaw)
  thread.updatedAt = ARGV[4]
  redis.call("SET", KEYS[2], cjson.encode(thread))
end

return cjson.encode({ status = "ok", snapshot = snapshot })
`;

const compareAndSetListingLeadScript = `
local ledgerRaw = redis.call("GET", KEYS[1])
if not ledgerRaw then
  return cjson.encode({ status = "missing" })
end

local ledger = cjson.decode(ledgerRaw)
if ledger.revision ~= ARGV[1] then
  return cjson.encode({ status = "stale" })
end

local lead = ledger.leads[ARGV[2]]
if not lead or (lead.status == "saved" and ARGV[3] == "dismissed") then
  return cjson.encode({ status = "lead_missing" })
end

local sequence = redis.call("INCR", KEYS[2])
lead.status = ARGV[3]
ledger.revision = ARGV[4] .. sequence
ledger.leads[ARGV[2]] = lead
redis.call("SET", KEYS[1], cjson.encode(ledger))

return cjson.encode({ status = "ok", lead = lead, listingLedgerRevision = ledger.revision })
`;

const claimActionExecutionScript = `
local claimRaw = redis.call("GET", KEYS[1])
if claimRaw then
  local decoded = claimRaw
  local ok, parsed = pcall(cjson.decode, claimRaw)
  if ok then
    decoded = parsed
  end

  if type(decoded) == "string" then
    return cjson.encode({ status = "completed", executionId = decoded })
  end

  if decoded.payloadHash ~= ARGV[1] then
    return cjson.encode({ status = "conflict" })
  end

  if decoded.executionId ~= nil and decoded.executionId ~= cjson.null then
    return cjson.encode({ status = "completed", executionId = decoded.executionId })
  end

  return cjson.encode({ status = "in_progress" })
end

local actionRaw = redis.call("GET", KEYS[2])
if not actionRaw then
  return cjson.encode({ status = "action_not_found" })
end

local action = cjson.decode(actionRaw)
if action.status == "applied" or action.status == "dismissed" or action.failureKind == "permanent" then
  return cjson.encode({ status = "action_terminal" })
end

redis.call("SET", KEYS[1], cjson.encode({
  actionId = ARGV[2],
  idempotencyKey = ARGV[3],
  payloadHash = ARGV[1],
  createdAt = ARGV[4]
}))

return cjson.encode({ status = "claimed" })
`;

const updateActionScript = `
local actionRaw = redis.call("GET", KEYS[1])
if not actionRaw then
  return cjson.encode({ status = "action_not_found" })
end

local action = cjson.decode(actionRaw)
if ARGV[1] == "1" and (action.status == "applied" or action.status == "dismissed" or action.failureKind == "permanent") then
  return cjson.encode({ status = "action_terminal" })
end

action.status = ARGV[2]
action.updatedAt = ARGV[3]

if ARGV[4] == "" then
  action.error = nil
else
  action.error = ARGV[4]
end

if ARGV[5] == "" then
  action.failureKind = nil
else
  action.failureKind = ARGV[5]
end

redis.call("SET", KEYS[1], cjson.encode(action))

return cjson.encode({ status = "ok", action = action })
`;

const storedInstallationSchema: z.ZodType<StoredInstallation> = z
  .object({
    id: z.string().min(1).max(128),
    secretHash: z.string().min(1),
    threadIds: z.array(z.string().min(1).max(128)),
  })
  .strict();

const storedListingLedgerSchema: z.ZodType<StoredListingLedger> = z
  .object({
    threadId: z.string().min(1).max(128),
    revision: z.string().min(1).max(128),
    leads: z.record(z.string().min(1), listingLeadSchema),
  })
  .strict();

const storedActionExecutionClaimSchema: z.ZodType<StoredActionExecutionClaim> = z
  .object({
    actionId: z.string().min(1).max(128),
    idempotencyKey: z.string().min(1).max(128),
    payloadHash: z.string().min(1).max(128),
    createdAt: z.string().datetime(),
    executionId: z.string().min(1).max(128).optional(),
  })
  .strict();

const storedThreadIndexSchema: z.ZodType<StoredThreadIndex> = z
  .object({
    threadId: z.string().min(1).max(128),
    messageIds: z.array(z.string().min(1).max(128)),
    actionIds: z.array(z.string().min(1).max(128)),
    executionIds: z.array(z.string().min(1).max(128)),
    executionClaimKeys: z.array(z.string().min(1)),
  })
  .strict();

const redisMapSnapshotCompareAndSetResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing") }).strict(),
  z.object({ status: z.literal("stale") }).strict(),
  z.object({ status: z.literal("ok"), snapshot: mapSnapshotSchema }).strict(),
]);

const redisListingLeadCompareAndSetResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing") }).strict(),
  z.object({ status: z.literal("stale") }).strict(),
  z.object({ status: z.literal("lead_missing") }).strict(),
  z
    .object({
      status: z.literal("ok"),
      lead: listingLeadSchema,
      listingLedgerRevision: z.string().min(1).max(128),
    })
    .strict(),
]);

const redisActionExecutionClaimResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("claimed") }).strict(),
  z.object({ status: z.literal("completed"), executionId: z.string().min(1).max(128) }).strict(),
  z.object({ status: z.literal("conflict") }).strict(),
  z.object({ status: z.literal("in_progress") }).strict(),
  z.object({ status: z.literal("action_not_found") }).strict(),
  z.object({ status: z.literal("action_terminal") }).strict(),
]);

const redisActionUpdateResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("action_not_found") }).strict(),
  z.object({ status: z.literal("action_terminal") }).strict(),
  z.object({ status: z.literal("ok"), action: planningActionRecordSchema }).strict(),
]);

export function createRedisPlanningStore(
  redis: RedisPlanningClient = Redis.fromEnv(),
): PlanningStore {
  return {
    async createThread(input) {
      return createThread(redis, input);
    },
    async resetInstallation(input) {
      return resetInstallation(redis, input);
    },
    async getThread(threadId) {
      return parsePersistedPlanningThread(await redis.get(planningKey.thread(threadId)));
    },
    async verifyThreadOwnership(threadId, installationSecretHash) {
      return verifyThreadOwnership(redis, threadId, installationSecretHash);
    },
    async appendMessage(input) {
      return appendMessage(redis, input);
    },
    async getMessage(messageId) {
      return parsePersistedPlanningMessage(await redis.get(planningKey.message(messageId)));
    },
    async listRecentMessages(threadId, limit) {
      return listRecentMessages(redis, threadId, limit);
    },
    async createAction(input) {
      return createAction(redis, input);
    },
    async getAction(actionId) {
      return parsePersistedPlanningAction(await redis.get(planningKey.action(actionId)));
    },
    async listRecentActions(threadId, limit) {
      return listRecentActions(redis, threadId, limit);
    },
    async updateAction(input) {
      return updateAction(redis, input);
    },
    async claimActionExecution(input) {
      return claimActionExecution(redis, input);
    },
    async createExecution(input) {
      return createExecution(redis, input);
    },
    async getExecution(executionId) {
      return parsePersistedPlanningExecution(await redis.get(planningKey.execution(executionId)));
    },
    async getExecutionByIdempotencyKey(actionId, idempotencyKey) {
      const storedClaim = await redis.get(
        planningKey.executionByIdempotencyKey(actionId, idempotencyKey),
      );
      const executionId =
        typeof storedClaim === "string"
          ? storedClaim
          : parsePersistedActionExecutionClaim(storedClaim)?.executionId;

      return typeof executionId === "string"
        ? parsePersistedPlanningExecution(await redis.get(planningKey.execution(executionId)))
        : null;
    },
    async getMapSnapshot(threadId) {
      return parsePersistedMapSnapshot(await redis.get(planningKey.mapSnapshot(threadId)));
    },
    async getListingLead(threadId, canonicalUrl) {
      return parsePersistedListingLedger(await redis.get(planningKey.listingLedger(threadId)))?.leads[
        canonicalUrl
      ] ?? null;
    },
    async getListingLedgerRevision(threadId) {
      return parsePersistedListingLedger(await redis.get(planningKey.listingLedger(threadId)))
        ?.revision ?? null;
    },
    async getPreferenceMemory(threadId) {
      return parsePersistedPreferenceMemory(await redis.get(planningKey.preferenceMemory(threadId)));
    },
    async updatePreferenceMemory(input) {
      return updatePreferenceMemory(redis, input);
    },
    async updateMapSnapshot(input) {
      return updateMapSnapshot(redis, input);
    },
    async updateListingLeadStatus(input) {
      return updateListingLeadStatus(redis, input);
    },
    async buildExecutionResponse(actionId, executionId) {
      return buildExecutionResponse(redis, actionId, executionId);
    },
    hashPayload(payload) {
      return hashPayload(payload);
    },
  };
}

export const redisPlanningKey = planningKey;

export function parsePersistedPlanningThread(value: unknown): PlanningThread | null {
  return planningThreadSchema.safeParse(value).data ?? null;
}

export function parsePersistedMapSnapshot(value: unknown): MapSnapshot | null {
  return mapSnapshotSchema.safeParse(value).data ?? null;
}

export function parsePersistedPlanningMessage(value: unknown): PlanningMessage | null {
  return planningMessageSchema.safeParse(value).data ?? null;
}

export function parsePersistedPlanningAction(value: unknown): PlanningActionRecord | null {
  return planningActionRecordSchema.safeParse(value).data ?? null;
}

export function parsePersistedPlanningExecution(
  value: unknown,
): PlanningActionExecutionRecord | null {
  return planningActionExecutionRecordSchema.safeParse(value).data ?? null;
}

export function parsePersistedInstallation(value: unknown): StoredInstallation | null {
  return storedInstallationSchema.safeParse(value).data ?? null;
}

export function parsePersistedListingLedger(value: unknown): StoredListingLedger | null {
  return storedListingLedgerSchema.safeParse(value).data ?? null;
}

export function parsePersistedPreferenceMemory(value: unknown): PlanningContextSummary | null {
  return planningContextSummarySchema.safeParse(value).data ?? null;
}

export function parsePersistedActionExecutionClaim(
  value: unknown,
): StoredActionExecutionClaim | null {
  return storedActionExecutionClaimSchema.safeParse(value).data ?? null;
}

function parsePersistedThreadIndex(value: unknown): StoredThreadIndex | null {
  return storedThreadIndexSchema.safeParse(value).data ?? null;
}

async function createThread(
  redis: RedisPlanningClient,
  input: CreateThreadInput,
): Promise<CreateThreadStoreResult> {
  const sequence = await redis.incr(planningKey.sequence);
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
    mapState: input.initialMapState,
    revision: `map-rev-${sequence}`,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const installationKey = planningKey.installation(input.clientInstallationId);
  const persistedInstallation = await redis.get(installationKey);
  const installation = persistedInstallation
    ? parsePersistedInstallation(persistedInstallation)
    : null;

  if (persistedInstallation && !installation) {
    return { ok: false, error: "installation_record_invalid" };
  }

  if (installation && installation.secretHash !== input.clientInstallationSecretHash) {
    return { ok: false, error: "installation_secret_mismatch" };
  }

  const nextBaseInstallation = installation ?? {
    id: input.clientInstallationId,
    secretHash: input.clientInstallationSecretHash,
    threadIds: [],
  };
  const nextInstallation: StoredInstallation = {
    ...nextBaseInstallation,
    threadIds: [...nextBaseInstallation.threadIds, threadId],
  };

  await redis
    .multi()
    .set(planningKey.thread(threadId), thread)
    .set(planningKey.mapSnapshot(threadId), mapSnapshot)
    .set(planningKey.listingLedger(threadId), {
      threadId,
      revision: `ledger-rev-${sequence}`,
      leads: {},
    } satisfies StoredListingLedger)
    .set(planningKey.threadIndex(threadId), {
      threadId,
      messageIds: [],
      actionIds: [],
      executionIds: [],
      executionClaimKeys: [],
    } satisfies StoredThreadIndex)
    .set(installationKey, nextInstallation)
    .exec();

  return {
    ok: true,
    thread,
    mapSnapshot,
    listingLedgerRevision: `ledger-rev-${sequence}`,
  };
}

async function verifyThreadOwnership(
  redis: RedisPlanningClient,
  threadId: string,
  installationSecretHash: string,
) {
  const thread = parsePersistedPlanningThread(await redis.get(planningKey.thread(threadId)));

  if (!thread) {
    return false;
  }

  const installation = parsePersistedInstallation(
    await redis.get(planningKey.installation(thread.clientInstallationId)),
  );

  return installation?.secretHash === installationSecretHash;
}

async function appendMessage(
  redis: RedisPlanningClient,
  input: AppendMessageInput,
): Promise<PlanningMessage> {
  const sequence = await redis.incr(planningKey.sequence);
  const message: PlanningMessage = {
    id: `message-${sequence}`,
    threadId: input.threadId,
    role: input.role,
    parts: input.parts,
    createdAt: input.now,
  };
  const thread = parsePersistedPlanningThread(await redis.get(planningKey.thread(input.threadId)));
  const threadIndex = parsePersistedThreadIndex(await redis.get(planningKey.threadIndex(input.threadId)));
  const transaction = redis.multi().set(planningKey.message(message.id), message);

  if (thread) {
    transaction.set(planningKey.thread(input.threadId), {
      ...thread,
      updatedAt: input.now,
    });
  }

  if (threadIndex) {
    transaction.set(planningKey.threadIndex(input.threadId), {
      ...threadIndex,
      messageIds: [...threadIndex.messageIds, message.id],
    } satisfies StoredThreadIndex);
  }

  await transaction.exec();

  return message;
}

async function createAction(
  redis: RedisPlanningClient,
  input: CreateActionInput,
): Promise<PlanningActionRecord> {
  const action: PlanningActionRecord = {
    id: input.id,
    threadId: input.threadId,
    messageId: input.messageId,
    partIndex: input.partIndex,
    kind: input.kind,
    target: input.target,
    status: "pending",
    createdAt: input.now,
    updatedAt: input.now,
  };

  const threadIndex = parsePersistedThreadIndex(await redis.get(planningKey.threadIndex(input.threadId)));
  const transaction = redis.multi().set(planningKey.action(action.id), action);

  if (threadIndex) {
    transaction.set(planningKey.threadIndex(input.threadId), {
      ...threadIndex,
      actionIds: [...threadIndex.actionIds, action.id],
    } satisfies StoredThreadIndex);
  }

  await transaction.exec();
  await seedListingLeadFromMessage(redis, action);

  return action;
}

async function updateAction(
  redis: RedisPlanningClient,
  input: UpdateActionInput,
): Promise<UpdateActionResult> {
  const script = redis.createScript(updateActionScript);
  const result = redisActionUpdateResultSchema.parse(
    parseRedisScriptJson(
      await script.eval(
        [planningKey.action(input.actionId)],
        [
          input.onlyIfNotTerminal ? "1" : "0",
          input.status,
          input.now,
          input.error ?? "",
          input.failureKind ?? "",
        ],
      ),
    ),
  );

  if (result.status === "action_not_found") {
    return { ok: false, error: "action_not_found" };
  }

  if (result.status === "action_terminal") {
    return { ok: false, error: "action_terminal" };
  }

  return { ok: true, action: result.action };
}

async function claimActionExecution(
  redis: RedisPlanningClient,
  input: ClaimActionExecutionInput,
): Promise<ClaimActionExecutionResult> {
  const script = redis.createScript(claimActionExecutionScript);

  return redisActionExecutionClaimResultSchema.parse(
    parseRedisScriptJson(
      await script.eval(
        [
          planningKey.executionByIdempotencyKey(input.actionId, input.idempotencyKey),
          planningKey.action(input.actionId),
        ],
        [input.payloadHash, input.actionId, input.idempotencyKey, input.now],
      ),
    ),
  );
}

async function createExecution(
  redis: RedisPlanningClient,
  input: CreateExecutionInput,
): Promise<PlanningActionExecutionRecord> {
  const sequence = await redis.incr(planningKey.sequence);
  const action = parsePersistedPlanningAction(await redis.get(planningKey.action(input.actionId)));
  const execution: PlanningActionExecutionRecord = {
    id: `execution-${sequence}`,
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: input.payloadHash,
    status: input.status,
    createdAt: input.now,
    error: input.error,
  };

  const threadIndex =
    action ? parsePersistedThreadIndex(await redis.get(planningKey.threadIndex(action.threadId))) : null;
  const executionClaimKey = planningKey.executionByIdempotencyKey(
    input.actionId,
    input.idempotencyKey,
  );
  const transaction = redis
    .multi()
    .set(planningKey.execution(execution.id), execution)
    .set(executionClaimKey, {
      actionId: input.actionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      createdAt: input.now,
      executionId: execution.id,
    } satisfies StoredActionExecutionClaim);

  if (threadIndex && action) {
    transaction.set(planningKey.threadIndex(action.threadId), {
      ...threadIndex,
      executionIds: [...threadIndex.executionIds, execution.id],
      executionClaimKeys: [...threadIndex.executionClaimKeys, executionClaimKey],
    } satisfies StoredThreadIndex);
  }

  await transaction.exec();

  return execution;
}

async function resetInstallation(
  redis: RedisPlanningClient,
  input: {
    clientInstallationId: string;
    clientInstallationSecretHash: string;
  },
) {
  const installation = parsePersistedInstallation(
    await redis.get(planningKey.installation(input.clientInstallationId)),
  );

  if (!installation) {
    return { ok: false, error: "installation_not_found" } as const;
  }

  if (installation.secretHash !== input.clientInstallationSecretHash) {
    return { ok: false, error: "installation_secret_mismatch" } as const;
  }

  const keys = new Set<string>([planningKey.installation(input.clientInstallationId)]);

  for (const threadId of installation.threadIds) {
    keys.add(planningKey.thread(threadId));
    keys.add(planningKey.mapSnapshot(threadId));
    keys.add(planningKey.listingLedger(threadId));
    keys.add(planningKey.preferenceMemory(threadId));
    keys.add(planningKey.threadIndex(threadId));

    const threadIndex = parsePersistedThreadIndex(await redis.get(planningKey.threadIndex(threadId)));
    if (!threadIndex) {
      for (const derivedKey of await findOrphanedThreadKeys(redis, threadId)) {
        keys.add(derivedKey);
      }
      continue;
    }

    for (const messageId of threadIndex.messageIds) {
      keys.add(planningKey.message(messageId));
    }

    for (const actionId of threadIndex.actionIds) {
      keys.add(planningKey.action(actionId));
    }

    for (const executionId of threadIndex.executionIds) {
      keys.add(planningKey.execution(executionId));
    }

    for (const executionClaimKey of threadIndex.executionClaimKeys) {
      keys.add(executionClaimKey);
    }
  }

  if (keys.size > 0) {
    const deleteScript = redis.createScript(`
for _, key in ipairs(KEYS) do
  redis.call("DEL", key)
end
return cjson.encode({ status = "ok" })
`);
    await deleteScript.eval([...keys], []);
  }

  return { ok: true } as const;
}

async function listRecentMessages(
  redis: RedisPlanningClient,
  threadId: string,
  limit: number,
): Promise<PlanningMessage[]> {
  const boundedLimit = Math.max(0, Math.min(limit, 20));
  const threadIndex = parsePersistedThreadIndex(await redis.get(planningKey.threadIndex(threadId)));

  if (!threadIndex || boundedLimit === 0) {
    return [];
  }

  const messageIds = threadIndex.messageIds.slice(-boundedLimit);
  const messages = await Promise.all(
    messageIds.map((messageId) => redis.get(planningKey.message(messageId))),
  );

  return messages
    .map((message) => parsePersistedPlanningMessage(message))
    .filter((message): message is PlanningMessage => Boolean(message));
}

async function listRecentActions(
  redis: RedisPlanningClient,
  threadId: string,
  limit: number,
): Promise<PlanningActionRecord[]> {
  const boundedLimit = Math.max(0, Math.min(limit, 20));
  const threadIndex = parsePersistedThreadIndex(await redis.get(planningKey.threadIndex(threadId)));

  if (!threadIndex || boundedLimit === 0) {
    return [];
  }

  const actionIds = threadIndex.actionIds.slice(-boundedLimit);
  const actions = await Promise.all(
    actionIds.map((actionId) => redis.get(planningKey.action(actionId))),
  );

  return actions
    .map((action) => parsePersistedPlanningAction(action))
    .filter((action): action is PlanningActionRecord => Boolean(action));
}

async function updatePreferenceMemory(
  redis: RedisPlanningClient,
  input: {
    threadId: string;
    context: PlanningContextSummary;
    now: string;
  },
): Promise<PlanningContextSummary> {
  const current =
    parsePersistedPreferenceMemory(await redis.get(planningKey.preferenceMemory(input.threadId))) ??
    emptyPlanningContextSummary();
  const nextMemory = mergePreferenceMemory(current, input.context);
  const thread = parsePersistedPlanningThread(await redis.get(planningKey.thread(input.threadId)));
  const transaction = redis.multi().set(planningKey.preferenceMemory(input.threadId), nextMemory);

  if (thread) {
    transaction.set(planningKey.thread(input.threadId), {
      ...thread,
      updatedAt: input.now,
    });
  }

  await transaction.exec();

  return nextMemory;
}

async function findOrphanedThreadKeys(redis: RedisPlanningClient, threadId: string) {
  const scanScript = redis.createScript(`
local threadId = ARGV[1]
local keysToDelete = {}
local actionIds = {}

for _, messageKey in ipairs(redis.call("KEYS", "sf-apt-hunt:planning:message:*")) do
  local raw = redis.call("GET", messageKey)
  if raw then
    local decoded = cjson.decode(raw)
    if decoded.threadId == threadId then
      table.insert(keysToDelete, messageKey)
    end
  end
end

for _, actionKey in ipairs(redis.call("KEYS", "sf-apt-hunt:planning:action:*")) do
  local raw = redis.call("GET", actionKey)
  if raw then
    local decoded = cjson.decode(raw)
    if decoded.threadId == threadId then
      table.insert(keysToDelete, actionKey)
      actionIds[decoded.id] = true
    end
  end
end

for _, executionKey in ipairs(redis.call("KEYS", "sf-apt-hunt:planning:execution:*")) do
  local raw = redis.call("GET", executionKey)
  if raw then
    local decoded = cjson.decode(raw)
    if actionIds[decoded.actionId] then
      table.insert(keysToDelete, executionKey)
    end
  end
end

for actionId, _ in pairs(actionIds) do
  for _, claimKey in ipairs(
    redis.call("KEYS", "sf-apt-hunt:planning:execution-by-idempotency:" .. actionId .. ":*")
  ) do
    table.insert(keysToDelete, claimKey)
  end
end

return cjson.encode(keysToDelete)
`);

  return z.array(z.string().min(1)).parse(parseRedisScriptJson(await scanScript.eval([], [threadId])));
}

async function updateMapSnapshot(
  redis: RedisPlanningClient,
  input: UpdateMapSnapshotInput,
): Promise<UpdateMapSnapshotResult> {
  return compareAndSetRedisMapSnapshot(redis, input);
}

async function updateListingLeadStatus(
  redis: RedisPlanningClient,
  input: UpdateListingLeadStatusInput,
): Promise<UpdateListingLeadStatusResult> {
  return compareAndSetRedisListingLeadStatus(redis, input);
}

export async function compareAndSetRedisMapSnapshot(
  redis: RedisPlanningClient,
  input: UpdateMapSnapshotInput,
): Promise<UpdateMapSnapshotResult> {
  const script = redis.createScript(compareAndSetMapSnapshotScript);
  const result = redisMapSnapshotCompareAndSetResultSchema.parse(
    parseRedisScriptJson(
      await script.eval(
        [
          planningKey.mapSnapshot(input.threadId),
          planningKey.thread(input.threadId),
          planningKey.sequence,
        ],
        [
          input.expectedRevision,
          JSON.stringify(input.mapState),
          "map-rev-",
          input.now,
        ],
      ),
    ),
  );

  if (result.status === "missing") {
    return { ok: false, error: "thread_not_found" };
  }

  if (result.status === "stale") {
    return { ok: false, error: "stale_map_revision" };
  }

  return { ok: true, snapshot: result.snapshot };
}

export async function compareAndSetRedisListingLeadStatus(
  redis: RedisPlanningClient,
  input: UpdateListingLeadStatusInput,
): Promise<UpdateListingLeadStatusResult> {
  const script = redis.createScript(compareAndSetListingLeadScript);
  const result = redisListingLeadCompareAndSetResultSchema.parse(
    parseRedisScriptJson(
      await script.eval(
        [planningKey.listingLedger(input.threadId), planningKey.sequence],
        [
          input.expectedRevision,
          input.canonicalUrl,
          input.status,
          "ledger-rev-",
          input.now,
        ],
      ),
    ),
  );

  if (result.status === "missing") {
    return { ok: false, error: "thread_not_found" };
  }

  if (result.status === "stale") {
    return { ok: false, error: "stale_listing_ledger_revision" };
  }

  if (result.status === "lead_missing") {
    return { ok: false, error: "listing_lead_not_found" };
  }

  return {
    ok: true,
    lead: result.lead,
    listingLedgerRevision: result.listingLedgerRevision,
  };
}

async function buildExecutionResponse(
  redis: RedisPlanningClient,
  actionId: string,
  executionId: string,
) {
  const action = parsePersistedPlanningAction(await redis.get(planningKey.action(actionId)));
  const execution = parsePersistedPlanningExecution(
    await redis.get(planningKey.execution(executionId)),
  );

  if (!action || !execution) {
    throw new Error("Planning execution response records are missing.");
  }

  const response = { action, execution };

  if (
    action.target.kind === "mapProposal" ||
    action.target.kind === "mapProposalItem" ||
    action.target.kind === "targetEdit"
  ) {
    const snapshot = parsePersistedMapSnapshot(
      await redis.get(planningKey.mapSnapshot(action.threadId)),
    );

    return snapshot ? { ...response, mapSnapshot: snapshot, mapState: snapshot.mapState } : response;
  }

  if (action.target.kind === "listingLead") {
    const ledger = parsePersistedListingLedger(
      await redis.get(planningKey.listingLedger(action.threadId)),
    );
    const lead = ledger?.leads[action.target.canonicalUrl];

    return lead && ledger
      ? {
          ...response,
          listingLead: lead,
          listingLedgerRevision: ledger.revision,
        }
      : response;
  }

  return response;
}

async function seedListingLeadFromMessage(
  redis: RedisPlanningClient,
  action: PlanningActionRecord,
) {
  if (action.target.kind !== "listingLead" || action.kind !== "listingSave") {
    return;
  }

  const canonicalUrl = action.target.canonicalUrl;
  const ledger = parsePersistedListingLedger(
    await redis.get(planningKey.listingLedger(action.threadId)),
  );
  const message = parsePersistedPlanningMessage(
    await redis.get(planningKey.message(action.messageId)),
  );

  if (!ledger || !message) {
    return;
  }

  const part = message.parts[action.partIndex];

  if (part?.type !== "listingResults") {
    return;
  }

  const card = part.listings.find((listing) => listing.lead.canonicalUrl === canonicalUrl);

  if (!card) {
    return;
  }

  const mergedLead = mergeReappearingListingLead(ledger.leads[canonicalUrl] ?? null, card.lead);

  await redis
    .multi()
    .set(planningKey.listingLedger(action.threadId), {
      ...ledger,
      leads: {
        ...ledger.leads,
        [canonicalUrl]: mergedLead,
      },
    } satisfies StoredListingLedger)
    .exec();
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

function parseRedisScriptJson(value: unknown): unknown {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}
