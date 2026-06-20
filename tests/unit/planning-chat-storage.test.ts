import { describe, expect, it } from "vitest";

import type {
  PlanningActionRecord,
  PlanningChatResponse,
  PlanningContextSummary,
  PlanningMessage,
  PlanningThread,
} from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import {
  clearPlanningChatState,
  clearPlanningThreadCache,
  loadOrCreatePlanningInstallation,
  loadPlanningThreadCache,
  savePlanningThreadCache,
} from "@/lib/storage/planning-chat-storage";

const planningInstallationStorageKey = "sf-apt-hunt:planning-installation:v1";
const planningThreadCacheStorageKey = "sf-apt-hunt:planning-thread-cache:v1";

class FakeStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("planning chat storage", () => {
  it("creates a stable anonymous installation identity", () => {
    const storage = new FakeStorage();

    const first = loadOrCreatePlanningInstallation(storage);
    const second = loadOrCreatePlanningInstallation(storage);

    expect(second).toEqual(first);
    expect(first.clientInstallationId).toMatch(/^install-/);
    expect(first.clientInstallationSecret.length).toBeGreaterThan(32);
    expect(storage.getItem(planningInstallationStorageKey)).not.toBeNull();
  });

  it("saves and reloads the planning thread cache", () => {
    const storage = new FakeStorage();
    const response = createPlanningChatResponse();

    savePlanningThreadCache(
      {
        thread: response.thread,
        messages: [response.userMessage, response.assistantMessage],
        actionRecords: response.actionRecords,
        contextSummary: response.contextSummary,
        contextSummariesByMessageId: {
          [response.assistantMessage.id]: response.contextSummary,
        },
        mapSnapshot: response.mapSnapshot,
        listingLedgerRevision: response.listingLedgerRevision,
      },
      storage,
    );

    expect(loadPlanningThreadCache(storage)).toEqual({
      thread: response.thread,
      messages: [response.userMessage, response.assistantMessage],
      actionRecords: response.actionRecords,
      contextSummary: response.contextSummary,
      contextSummariesByMessageId: {
        [response.assistantMessage.id]: response.contextSummary,
      },
      mapSnapshot: response.mapSnapshot,
      listingLedgerRevision: response.listingLedgerRevision,
    });
    expect(storage.getItem(planningThreadCacheStorageKey)).not.toBeNull();
  });

  it("rejects older planning thread cache records without message context summaries", () => {
    const storage = new FakeStorage();
    const response = createPlanningChatResponse();

    storage.setItem(
      planningThreadCacheStorageKey,
      JSON.stringify({
        thread: response.thread,
        messages: [response.userMessage, response.assistantMessage],
        actionRecords: response.actionRecords,
        contextSummary: response.contextSummary,
        mapSnapshot: response.mapSnapshot,
        listingLedgerRevision: response.listingLedgerRevision,
      }),
    );

    expect(loadPlanningThreadCache(storage)).toBeNull();
  });

  it("loads planning thread cache records with message context summaries", () => {
    const storage = new FakeStorage();
    const response = createPlanningChatResponse();

    storage.setItem(
      planningThreadCacheStorageKey,
      JSON.stringify({
        thread: response.thread,
        messages: [response.userMessage, response.assistantMessage],
        actionRecords: response.actionRecords,
        contextSummary: response.contextSummary,
        contextSummariesByMessageId: {
          [response.assistantMessage.id]: response.contextSummary,
        },
        mapSnapshot: response.mapSnapshot,
        listingLedgerRevision: response.listingLedgerRevision,
      }),
    );

    expect(loadPlanningThreadCache(storage)).toEqual({
      thread: response.thread,
      messages: [response.userMessage, response.assistantMessage],
      actionRecords: response.actionRecords,
      contextSummary: response.contextSummary,
      contextSummariesByMessageId: {
        [response.assistantMessage.id]: response.contextSummary,
      },
      mapSnapshot: response.mapSnapshot,
      listingLedgerRevision: response.listingLedgerRevision,
    });
  });

  it("clears the cached planning thread", () => {
    const storage = new FakeStorage();

    savePlanningThreadCache(
      {
        thread: createPlanningThread(),
        messages: [createPlanningMessage("message-1", "user")],
        actionRecords: [],
        contextSummary: createContextSummary(),
        contextSummariesByMessageId: {},
        mapSnapshot: {
          id: "snapshot-1",
          threadId: "thread-1",
          clientInstallationId: "install-1",
          mapState: seedMapState,
          revision: "map-rev-1",
          createdAt: "2026-06-18T12:00:00.000Z",
          updatedAt: "2026-06-18T12:00:00.000Z",
        },
        listingLedgerRevision: "ledger-rev-1",
      },
      storage,
    );

    clearPlanningThreadCache(storage);

    expect(loadPlanningThreadCache(storage)).toBeNull();
    expect(storage.getItem(planningThreadCacheStorageKey)).toBeNull();
  });

  it("clears planning chat cache without deleting the installation identity", () => {
    const storage = new FakeStorage();
    const installation = loadOrCreatePlanningInstallation(storage);

    savePlanningThreadCache(
      {
        thread: createPlanningThread(),
        messages: [createPlanningMessage("message-1", "user")],
        actionRecords: [],
        contextSummary: createContextSummary(),
        contextSummariesByMessageId: {},
        mapSnapshot: {
          id: "snapshot-1",
          threadId: "thread-1",
          clientInstallationId: "install-1",
          mapState: seedMapState,
          revision: "map-rev-1",
          createdAt: "2026-06-18T12:00:00.000Z",
          updatedAt: "2026-06-18T12:00:00.000Z",
        },
        listingLedgerRevision: "ledger-rev-1",
      },
      storage,
    );

    clearPlanningChatState(storage);

    expect(loadPlanningThreadCache(storage)).toBeNull();
    expect(storage.getItem(planningThreadCacheStorageKey)).toBeNull();
    expect(loadOrCreatePlanningInstallation(storage)).toEqual(installation);
    expect(storage.getItem(planningInstallationStorageKey)).not.toBeNull();
  });
});

function createPlanningChatResponse(): PlanningChatResponse {
  return {
    thread: createPlanningThread(),
    userMessage: createPlanningMessage("message-user-1", "user"),
    assistantMessage: createPlanningMessage("message-assistant-1", "assistant"),
    contextSummary: createContextSummary(),
    actionRecords: [createPlanningActionRecord()],
    mapSnapshot: {
      id: "snapshot-1",
      threadId: "thread-1",
      clientInstallationId: "install-1",
      mapState: seedMapState,
      revision: "map-rev-1",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
    },
    listingLedgerRevision: "ledger-rev-1",
  };
}

function createPlanningThread(): PlanningThread {
  return {
    id: "thread-1",
    clientInstallationId: "install-1",
    createdAt: "2026-06-18T12:00:00.000Z",
    updatedAt: "2026-06-18T12:00:00.000Z",
    title: "Solidcore planning",
    summary: "Add reviewed pins and shortlist listings.",
  };
}

function createPlanningMessage(id: string, role: PlanningMessage["role"]): PlanningMessage {
  return {
    id,
    threadId: "thread-1",
    role,
    parts:
      role === "user"
        ? [{ type: "text", text: "Add pins for Solidcore in SF" }]
        : [
            { type: "text", text: "I found one reviewed map change." },
            {
              type: "mapProposal",
              actionId: "action-map-1",
              proposal: {
                summary: "Add 1 map change",
                confidence: "high",
                requiresUserReview: true,
                operations: [
                  {
                    type: "addTarget",
                    target: {
                      id: "solidcore-presidio",
                      name: "Solidcore",
                      purpose: "fitness class",
                      coordinates: [-122.433, 37.785],
                      priority: "medium",
                      influence: "positive",
                      radiusMinutes: 10,
                      notes: [],
                    },
                  },
                ],
              },
              researchSummary: null,
            },
          ],
    createdAt: "2026-06-18T12:00:00.000Z",
  };
}

function createPlanningActionRecord(): PlanningActionRecord {
  return {
    id: "action-map-1",
    threadId: "thread-1",
    messageId: "message-assistant-1",
    partIndex: 1,
    kind: "mapProposal",
    target: {
      kind: "mapProposal",
      messageId: "message-assistant-1",
      partIndex: 1,
      proposalHash: "proposal-hash-1",
      allowedOperationIndexes: [0],
      mapRevision: "map-rev-1",
    },
    status: "pending",
    createdAt: "2026-06-18T12:00:00.000Z",
    updatedAt: "2026-06-18T12:00:00.000Z",
  };
}

function createContextSummary(): PlanningContextSummary {
  return {
    budget: 3000,
    beds: "studio",
    timing: "July",
    furnished: false,
    shortTerm: false,
    positiveAnchors: ["Mission favorite block"],
    avoidAnchors: [],
    selectedZones: ["Lower Pac Heights"],
    sourceStrictness: null,
  };
}
