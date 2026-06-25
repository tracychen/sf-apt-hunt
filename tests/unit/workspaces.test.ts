import { beforeEach, describe, expect, test, vi } from "vitest";

import { seedMapState } from "@/lib/map/seed-data";
import {
  deleteDefaultWorkspaceForUser,
  getOrCreateDefaultWorkspace,
  serializeWorkspaceRecord,
} from "@/lib/server/workspaces";

const dbMock = vi.hoisted(() => ({
  current: createWorkspaceDbMock(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, value: unknown) => ({ value }),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => dbMock.current,
}));

describe("workspace helpers", () => {
  beforeEach(() => {
    dbMock.current = createWorkspaceDbMock();
  });

  test("creates a clean default workspace and map snapshot", async () => {
    const result = await getOrCreateDefaultWorkspace("user-1", new Date("2026-06-23T12:00:00.000Z"));

    expect(result.workspace.userId).toBe("user-1");
    expect(result.workspace.name).toBe("Apartment hunt");
    expect(result.workspace.listingLedgerRevision).toMatch(/^ledger-/);
    expect(result.mapSnapshot.mapState).toEqual(seedMapState);
    expect(result.mapSnapshot.revision).toMatch(/^map-/);
  });

  test("serializes a default onboarding progress until workspace persistence lands", () => {
    expect(
      serializeWorkspaceRecord({
        id: "workspace-1",
        userId: "user-1",
        name: "Apartment hunt",
        listingLedgerRevision: "ledger-123",
        createdAt: new Date("2026-06-23T12:00:00.000Z"),
        updatedAt: new Date("2026-06-23T12:05:00.000Z"),
      }).onboardingProgress,
    ).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: "2026-06-23T12:05:00.000Z",
    });
  });

  test("returns the same workspace on repeated calls", async () => {
    const first = await getOrCreateDefaultWorkspace("user-1");
    const second = await getOrCreateDefaultWorkspace("user-1");

    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.mapSnapshot.id).toBe(first.mapSnapshot.id);
  });

  test("deleting the default workspace lets the next load create a fresh one", async () => {
    const first = await getOrCreateDefaultWorkspace("user-1");

    await expect(deleteDefaultWorkspaceForUser("user-1")).resolves.toEqual({ deleted: true });

    const second = await getOrCreateDefaultWorkspace("user-1");

    expect(second.workspace.id).not.toBe(first.workspace.id);
    expect(second.mapSnapshot.id).not.toBe(first.mapSnapshot.id);
    expect(second.mapSnapshot.mapState).toEqual(seedMapState);
  });
});

function createWorkspaceDbMock() {
  type WorkspaceValue = {
    id: string;
    userId: string;
    name: string;
    listingLedgerRevision: string;
    createdAt: Date;
    updatedAt: Date;
  };
  type SnapshotValue = {
    id: string;
    workspaceId: string;
    revision: string;
    mapState: typeof seedMapState;
    createdAt: Date;
    updatedAt: Date;
  };
  const workspacesByUser = new Map<string, WorkspaceValue>();
  const snapshotsByWorkspace = new Map<string, SnapshotValue>();

  return {
    insert() {
      return {
        values(value: WorkspaceValue | SnapshotValue) {
          return {
            onConflictDoUpdate() {
              return {
                async returning() {
                  if ("userId" in value) {
                    const existing = workspacesByUser.get(value.userId);
                    if (existing) {
                      return [existing];
                    }
                    workspacesByUser.set(value.userId, value);
                    return [value];
                  }

                  const existing = snapshotsByWorkspace.get(value.workspaceId);
                  if (existing) {
                    return [existing];
                  }
                  snapshotsByWorkspace.set(value.workspaceId, value);
                  return [value];
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where(condition: { value: string }) {
              return {
                async limit() {
                  return Array.from(snapshotsByWorkspace.values())
                    .filter((snapshot) => snapshot.workspaceId === condition.value)
                    .slice(0, 1);
                },
              };
            },
          };
        },
      };
    },
    delete() {
      return {
        where(condition: { value: string }) {
          return {
            async returning() {
              const existing = workspacesByUser.get(condition.value);

              if (!existing) {
                return [];
              }

              workspacesByUser.delete(condition.value);
              snapshotsByWorkspace.delete(existing.id);
              return [{ id: existing.id }];
            },
          };
        },
      };
    },
  };
}
