import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/planning/reset/route";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";
import type { PlanningStore } from "@/lib/server/planning/store";
import { seedMapState } from "@/lib/map/seed-data";

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

describe("POST /api/planning/reset", () => {
  beforeEach(() => {
    planningStoreMock.current = createMemoryPlanningStore();
    workspacePlanningStoresMock.current = new Map();
    sessionMock.userId = null;
    workspaceMock.id = "workspace-1";
  });

  test("reset rejects requests without installation secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/planning/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientInstallationId: "install-1" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("reset clears planning records for the owned installation", async () => {
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

    const response = await POST(
      new Request("http://localhost/api/planning/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sf-apt-installation-secret": "secret-1",
        },
        body: JSON.stringify({ clientInstallationId: "install-1" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(store.getThread(created.thread.id)).resolves.toBeNull();
    await expect(store.getMapSnapshot(created.thread.id)).resolves.toBeNull();
    await expect(store.getListingLedgerRevision(created.thread.id)).resolves.toBeNull();
  });

  test("reset is idempotent for the same owned installation identity", async () => {
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

    const request = () =>
      new Request("http://localhost/api/planning/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sf-apt-installation-secret": "secret-1",
        },
        body: JSON.stringify({ clientInstallationId: "install-1" }),
      });

    const firstResponse = await POST(request());
    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ ok: true });

    const secondResponse = await POST(request());
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({ ok: true });
    await expect(store.getThread(created.thread.id)).resolves.toBeNull();
  });

  test("signed-in planning reset clears workspace planning rows", async () => {
    sessionMock.userId = "user-1";
    const workspaceStore = createWorkspacePlanningStore("workspace-1");
    workspacePlanningStoresMock.current.set("workspace-1", workspaceStore);
    const created = await workspaceStore.createThread({
      clientInstallationId: "workspace-1",
      clientInstallationSecretHash: "unused",
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    if (!created.ok) {
      throw new Error(`Failed to create thread: ${created.error}`);
    }

    const response = await POST(
      new Request("http://localhost/api/planning/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientInstallationId: "ignored-in-workspace-mode" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(workspaceStore.getThread(created.thread.id)).resolves.toBeNull();
  });

  test("signed-in planning reset rejects cross-site requests", async () => {
    sessionMock.userId = "user-1";
    workspacePlanningStoresMock.current.set("workspace-1", createWorkspacePlanningStore("workspace-1"));

    const response = await POST(
      new Request("http://localhost/api/planning/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ clientInstallationId: "ignored-in-workspace-mode" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Forbidden origin.",
    });
  });

  test("unsigned planning reset preserves installation-secret access for cross-site requests", async () => {
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

    const response = await POST(
      new Request("http://localhost/api/planning/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          "x-sf-apt-installation-secret": "secret-1",
        },
        body: JSON.stringify({ clientInstallationId: "install-1" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(store.getThread(created.thread.id)).resolves.toBeNull();
  });
});

function getTestStore() {
  if (!planningStoreMock.current) {
    throw new Error("Planning store mock was not initialized.");
  }

  return planningStoreMock.current;
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
