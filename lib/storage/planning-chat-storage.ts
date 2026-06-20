import { z } from "zod";

import {
  mapSnapshotSchema,
  planningActionRecordSchema,
  planningContextSummarySchema,
  planningMessageSchema,
  planningThreadSchema,
} from "@/lib/domain/schemas";

const planningInstallationStorageKey = "sf-apt-hunt:planning-installation:v1";
const planningThreadCacheStorageKey = "sf-apt-hunt:planning-thread-cache:v1";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type PlanningInstallation = {
  clientInstallationId: string;
  clientInstallationSecret: string;
};

export type PlanningThreadCache = {
  thread: z.infer<typeof planningThreadSchema>;
  messages: Array<z.infer<typeof planningMessageSchema>>;
  actionRecords: Array<z.infer<typeof planningActionRecordSchema>>;
  contextSummary: z.infer<typeof planningContextSummarySchema>;
  contextSummariesByMessageId: Record<string, z.infer<typeof planningContextSummarySchema>>;
  mapSnapshot: z.infer<typeof mapSnapshotSchema>;
  listingLedgerRevision: string;
};

const planningInstallationSchema = z
  .object({
    clientInstallationId: z.string().min(1),
    clientInstallationSecret: z.string().min(1),
  })
  .strict();

const planningThreadCacheSchema = z
  .object({
    thread: planningThreadSchema,
    messages: z.array(planningMessageSchema),
    actionRecords: z.array(planningActionRecordSchema),
    contextSummary: planningContextSummarySchema,
    contextSummariesByMessageId: z.record(z.string(), planningContextSummarySchema),
    mapSnapshot: mapSnapshotSchema,
    listingLedgerRevision: z.string().min(1),
  })
  .strict();

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveLocalStorage(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? getBrowserLocalStorage();
  } catch {
    return null;
  }
}

function safeGetItem(storage: StorageLike, key: string) {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeRemoveItem(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}

function safeSetItem(storage: StorageLike, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    return;
  }
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadPlanningInstallation(storage?: StorageLike): PlanningInstallation | null {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return null;
  }

  const rawInstallation = safeGetItem(localStorage, planningInstallationStorageKey);
  if (!rawInstallation.ok || rawInstallation.value === null) {
    return null;
  }

  const result = planningInstallationSchema.safeParse(parseJson(rawInstallation.value));
  return result.success ? result.data : null;
}

export function savePlanningInstallation(
  installation: PlanningInstallation,
  storage?: StorageLike,
) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  const result = planningInstallationSchema.safeParse(installation);
  if (!result.success) {
    return;
  }

  safeSetItem(localStorage, planningInstallationStorageKey, JSON.stringify(result.data));
}

export function loadOrCreatePlanningInstallation(storage?: StorageLike) {
  const existing = loadPlanningInstallation(storage);
  if (existing) {
    return existing;
  }

  const next = {
    clientInstallationId: `install-${crypto.randomUUID()}`,
    clientInstallationSecret: `${crypto.randomUUID()}${crypto.randomUUID()}`,
  };
  savePlanningInstallation(next, storage);
  return next;
}

export function loadPlanningThreadCache(storage?: StorageLike): PlanningThreadCache | null {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return null;
  }

  const rawCache = safeGetItem(localStorage, planningThreadCacheStorageKey);
  if (!rawCache.ok || rawCache.value === null) {
    return null;
  }

  const result = planningThreadCacheSchema.safeParse(parseJson(rawCache.value));
  return result.success ? result.data : null;
}

export function savePlanningThreadCache(cache: PlanningThreadCache, storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  const result = planningThreadCacheSchema.safeParse(cache);
  if (!result.success) {
    return;
  }

  safeSetItem(localStorage, planningThreadCacheStorageKey, JSON.stringify(result.data));
}

export function clearPlanningThreadCache(storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  safeRemoveItem(localStorage, planningThreadCacheStorageKey);
}

export function clearPlanningChatState(storage?: StorageLike) {
  clearPlanningThreadCache(storage);
}
