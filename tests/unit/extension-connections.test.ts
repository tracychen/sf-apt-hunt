import { beforeEach, describe, expect, test, vi } from "vitest";

import { extensionConnectionTokens } from "@/lib/db/schema";

const dbMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof createExtensionConnectionsDbMock> | null,
}));

const workspaceHelpersMock = vi.hoisted(() => ({
  getOrCreateDefaultWorkspace: vi.fn(),
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");

  return {
    ...actual,
    randomBytes: vi.fn(() => ({
      toString: () => "plain-token",
    })),
    randomUUID: vi.fn(() => "uuid-1"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  isNull: (column: unknown) => ({ type: "isNull", column }),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => {
    if (!dbMock.current) {
      throw new Error("Database mock not initialized");
    }

    return dbMock.current;
  },
}));

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: workspaceHelpersMock.getOrCreateDefaultWorkspace,
}));

import {
  createExtensionConnection,
  isAllowedExtensionId,
  revokeExtensionBearer,
  revokeWorkspaceExtensionConnections,
  validateExtensionBearer,
} from "@/lib/server/extension/connections";

describe("extension connections", () => {
  beforeEach(() => {
    vi.stubEnv("EXTENSION_ALLOWED_IDS", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    dbMock.current = createExtensionConnectionsDbMock();
    workspaceHelpersMock.getOrCreateDefaultWorkspace.mockReset();
    workspaceHelpersMock.getOrCreateDefaultWorkspace.mockResolvedValue({
      workspace: {
        id: "workspace-1",
        userId: "user-1",
        name: "Apartment hunt",
        listingLedgerRevision: "ledger-1",
        createdAt: new Date("2026-06-30T02:00:00.000Z"),
        updatedAt: new Date("2026-06-30T02:00:00.000Z"),
      },
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-1",
        mapState: null,
        createdAt: new Date("2026-06-30T02:00:00.000Z"),
        updatedAt: new Date("2026-06-30T02:00:00.000Z"),
      },
    });
  });

  test("allows only configured Chrome extension ids", () => {
    expect(isAllowedExtensionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isAllowedExtensionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
    expect(isAllowedExtensionId("not-an-id")).toBe(false);
  });

  test("creates a scoped token for the signed-in user's default workspace", async () => {
    workspaceHelpersMock.getOrCreateDefaultWorkspace.mockResolvedValueOnce({
      workspace: {
        id: "workspace-99",
        userId: "user-1",
        name: "Resolved default workspace",
        listingLedgerRevision: "ledger-99",
        createdAt: new Date("2026-06-30T02:00:00.000Z"),
        updatedAt: new Date("2026-06-30T02:00:00.000Z"),
      },
      mapSnapshot: {
        id: "snapshot-99",
        workspaceId: "workspace-99",
        revision: "map-99",
        mapState: null,
        createdAt: new Date("2026-06-30T02:00:00.000Z"),
        updatedAt: new Date("2026-06-30T02:00:00.000Z"),
      },
    });
    const now = new Date("2026-06-30T02:00:00.000Z");

    const result = await createExtensionConnection({
      user: { id: "user-1", email: "tracy@example.com" },
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      now,
    });

    expect(result).toEqual({
      ok: true,
      token: "plain-token",
      expiresAt: "2026-07-30T02:00:00.000Z",
      account: { email: "tracy@example.com" },
      workspace: { id: "workspace-99", name: "Resolved default workspace" },
    });
    expect(workspaceHelpersMock.getOrCreateDefaultWorkspace).toHaveBeenCalledWith("user-1", now);

    expect(getCurrentDb().state.extensionConnectionTokens[0]).toMatchObject({
      userId: "user-1",
      workspaceId: "workspace-99",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      scope: "facebook_listing_import",
    });
    expect(getCurrentDb().state.extensionConnectionTokens[0].tokenHash).not.toBe("plain-token");
  });

  test("rejects creating a token for an unapproved extension id", async () => {
    await expect(
      createExtensionConnection({
        user: { id: "user-1", email: "tracy@example.com" },
        extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, error: "extension_not_allowed" });

    expect(workspaceHelpersMock.getOrCreateDefaultWorkspace).not.toHaveBeenCalled();
    expect(getCurrentDb().state.extensionConnectionTokens).toHaveLength(0);
  });

  test("validates an active scoped bearer token", async () => {
    const token = await seedActiveToken();

    await expect(
      validateExtensionBearer({
        token,
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({
      ok: true,
      userId: "user-1",
      workspaceId: "workspace-1",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  test("rejects token validation when extension id does not match", async () => {
    const token = await seedActiveToken();

    await expect(
      validateExtensionBearer({
        token,
        extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, error: "unauthorized" });
  });

  test("rejects expired bearer tokens", async () => {
    const token = await seedActiveToken();
    getCurrentDb().state.extensionConnectionTokens[0].expiresAt = new Date(
      "2026-06-29T02:00:00.000Z",
    );

    await expect(
      validateExtensionBearer({
        token,
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, error: "token_expired" });
  });

  test("rejects revoked bearer tokens", async () => {
    const token = await seedActiveToken();
    getCurrentDb().state.extensionConnectionTokens[0].revokedAt = new Date(
      "2026-06-30T01:00:00.000Z",
    );

    await expect(
      validateExtensionBearer({
        token,
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, error: "unauthorized" });
  });

  test("revokes the active bearer token", async () => {
    const token = await seedActiveToken();

    await expect(
      revokeExtensionBearer({
        token,
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: true });

    expect(getCurrentDb().state.extensionConnectionTokens[0].revokedAt?.toISOString()).toBe(
      "2026-06-30T02:00:00.000Z",
    );
  });

  test("revokes all active extension tokens for a workspace", async () => {
    await seedActiveToken();
    getCurrentDb().state.extensionConnectionTokens.push({
      id: "extension-token-2",
      userId: "user-1",
      workspaceId: "workspace-1",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tokenHash: "another-hash",
      scope: "facebook_listing_import",
      expiresAt: new Date("2026-07-30T02:00:00.000Z"),
      revokedAt: null,
      createdAt: new Date("2026-06-30T02:00:00.000Z"),
      updatedAt: new Date("2026-06-30T02:00:00.000Z"),
    });
    getCurrentDb().state.extensionConnectionTokens.push({
      id: "extension-token-3",
      userId: "user-1",
      workspaceId: "workspace-2",
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tokenHash: "workspace-2-hash",
      scope: "facebook_listing_import",
      expiresAt: new Date("2026-07-30T02:00:00.000Z"),
      revokedAt: null,
      createdAt: new Date("2026-06-30T02:00:00.000Z"),
      updatedAt: new Date("2026-06-30T02:00:00.000Z"),
    });

    await revokeWorkspaceExtensionConnections({
      userId: "user-1",
      workspaceId: "workspace-1",
      now: new Date("2026-06-30T03:00:00.000Z"),
    });

    expect(
      getCurrentDb().state.extensionConnectionTokens
        .filter((row) => row.workspaceId === "workspace-1")
        .map((row) => row.revokedAt?.toISOString()),
    ).toEqual(["2026-06-30T03:00:00.000Z", "2026-06-30T03:00:00.000Z"]);
    expect(
      getCurrentDb().state.extensionConnectionTokens.find((row) => row.workspaceId === "workspace-2")
        ?.revokedAt,
    ).toBeNull();
  });
});

function getCurrentDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

async function seedActiveToken() {
  const result = await createExtensionConnection({
    user: { id: "user-1", email: "tracy@example.com" },
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    now: new Date("2026-06-30T02:00:00.000Z"),
  });

  if (!result.ok) {
    throw new Error("Expected token creation to succeed in test setup.");
  }

  return result.token;
}

function createExtensionConnectionsDbMock() {
  const committedState = {
    extensionConnectionTokens: [] as Array<{
      id: string;
      userId: string;
      workspaceId: string;
      extensionId: string;
      tokenHash: string;
      scope: "facebook_listing_import";
      expiresAt: Date;
      revokedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>,
  };

  return {
    query: {
      extensionConnectionTokens: {
        findFirst: async ({ where }: { where: unknown }) =>
          committedState.extensionConnectionTokens.find((row) => matchesCondition(row, where)),
      },
    },
    insert(table: unknown) {
      if (table !== extensionConnectionTokens) {
        throw new Error("Unexpected insert table");
      }

      return {
        values(values: (typeof committedState.extensionConnectionTokens)[number]) {
          committedState.extensionConnectionTokens.push(structuredClone(values));
          return Promise.resolve();
        },
      };
    },
    update(table: unknown) {
      if (table !== extensionConnectionTokens) {
        throw new Error("Unexpected update table");
      }

      return {
        set(values: Partial<(typeof committedState.extensionConnectionTokens)[number]>) {
          return {
            where(condition: unknown) {
              committedState.extensionConnectionTokens = committedState.extensionConnectionTokens.map(
                (row) => (matchesCondition(row, condition) ? { ...row, ...values } : row),
              );

              return Promise.resolve();
            },
          };
        },
      };
    },
    get state() {
      return committedState;
    },
  };
}

function matchesCondition(record: Record<string, unknown>, condition: unknown): boolean {
  if (!condition || typeof condition !== "object") {
    return true;
  }

  const typedCondition = condition as {
    type?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };

  if (typedCondition.type === "and") {
    return (typedCondition.conditions ?? []).every((nested) => matchesCondition(record, nested));
  }

  if (typedCondition.type === "eq") {
    return readColumnValue(record, typedCondition.column) === typedCondition.value;
  }

  if (typedCondition.type === "isNull") {
    return readColumnValue(record, typedCondition.column) == null;
  }

  return true;
}

function readColumnValue(record: Record<string, unknown>, column: unknown) {
  switch (column) {
    case extensionConnectionTokens.id:
      return record.id;
    case extensionConnectionTokens.userId:
      return record.userId;
    case extensionConnectionTokens.workspaceId:
      return record.workspaceId;
    case extensionConnectionTokens.extensionId:
      return record.extensionId;
    case extensionConnectionTokens.tokenHash:
      return record.tokenHash;
    case extensionConnectionTokens.scope:
      return record.scope;
    case extensionConnectionTokens.revokedAt:
      return record.revokedAt;
    default:
      return undefined;
  }
}
