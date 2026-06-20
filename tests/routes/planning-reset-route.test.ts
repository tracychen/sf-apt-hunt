import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/planning/reset/route";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";
import type { PlanningStore } from "@/lib/server/planning/store";
import { seedMapState } from "@/lib/map/seed-data";

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

describe("POST /api/planning/reset", () => {
  beforeEach(() => {
    planningStoreMock.current = createMemoryPlanningStore();
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
});

function getTestStore() {
  if (!planningStoreMock.current) {
    throw new Error("Planning store mock was not initialized.");
  }

  return planningStoreMock.current;
}
