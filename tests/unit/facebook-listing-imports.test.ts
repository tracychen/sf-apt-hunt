import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  facebookListingCaptures,
  facebookListingImportAttempts,
  listingLeads,
  workspaces,
} from "@/lib/db/schema";
import type { FacebookListingImportRequest } from "@/lib/domain/types";

const createRevisionMock = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof createFacebookImportDbMock> | null,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => {
    if (!dbMock.current) {
      throw new Error("Database mock not initialized");
    }

    return dbMock.current;
  },
}));

vi.mock("@/lib/db/workspace-revisions", () => ({
  createRevision: createRevisionMock,
}));

import {
  importFacebookListing,
  normalizeFacebookListingCandidate,
} from "@/lib/server/imports/facebook-listings";

describe("Facebook listing imports", () => {
  beforeEach(() => {
    dbMock.current = createFacebookImportDbMock();
    createRevisionMock.mockReset();
  });

  test("normalizes reviewed private-room details into a saved listing candidate", () => {
    const candidate = normalizeFacebookListingCandidate(createImportRequest());

    expect(candidate).toMatchObject({
      id: "facebook-67890",
      title: "$1,800 private room in Hayes Valley",
      url: "https://www.facebook.com/groups/12345/posts/67890",
      sourceDomain: "facebook.com",
      neighborhoodGuess: "Hayes Valley",
      locationText: "Hayes Valley",
      priceMonthly: 1800,
      beds: "unknown",
      shortTermSignal: true,
      furnishedSignal: true,
      caveats: expect.arrayContaining(["Utilities not confirmed"]),
    });
  });

  test("normalizes incomplete captures without blocking save", () => {
    const candidate = normalizeFacebookListingCandidate({
      ...createImportRequest(),
      reviewedDetails: null,
      incompleteFlags: ["missing_price", "missing_location"],
    });

    expect(candidate).toMatchObject({
      title: "Facebook listing",
      priceMonthly: null,
      locationConfidence: "low",
      markerPrecision: "none",
      caveats: expect.arrayContaining(["missing_price", "missing_location"]),
    });
  });

  test("imports a new Facebook capture and advances the listing ledger", async () => {
    createRevisionMock.mockReturnValueOnce("ledger-2");

    const result = await importFacebookListing({
      workspaceId: "workspace-1",
      request: createImportRequest(),
      now: new Date("2026-06-30T02:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.lead.status).toBe("saved");
    expect(result.ok && result.listingLedgerRevision).toBe("ledger-2");
    expect(getCurrentDb().state.facebookListingCaptures).toHaveLength(1);
    expect(getCurrentDb().state.facebookListingImportAttempts).toHaveLength(1);
  });

  test("replays the same idempotency key and payload without mutating seen count", async () => {
    createRevisionMock.mockReturnValueOnce("ledger-2");
    const first = await importFacebookListing({
      workspaceId: "workspace-1",
      request: createImportRequest(),
      now: new Date("2026-06-30T02:00:00.000Z"),
    });
    const seenCount = getCurrentDb().state.listingLeads[0]?.seenCount;
    const captureCount = getCurrentDb().state.facebookListingCaptures.length;
    const attemptCount = getCurrentDb().state.facebookListingImportAttempts.length;

    const replay = await importFacebookListing({
      workspaceId: "workspace-1",
      request: createImportRequest(),
      now: new Date("2026-06-30T02:01:00.000Z"),
    });

    expect(replay).toEqual(first);
    expect(getCurrentDb().state.listingLeads[0]?.seenCount).toBe(seenCount);
    expect(getCurrentDb().state.facebookListingCaptures).toHaveLength(captureCount);
    expect(getCurrentDb().state.facebookListingImportAttempts).toHaveLength(attemptCount);
    expect(createRevisionMock).toHaveBeenCalledTimes(1);
  });

  test("rejects same idempotency key with a different payload", async () => {
    createRevisionMock.mockReturnValueOnce("ledger-2");
    await importFacebookListing({
      workspaceId: "workspace-1",
      request: createImportRequest(),
      now: new Date("2026-06-30T02:00:00.000Z"),
    });

    const result = await importFacebookListing({
      workspaceId: "workspace-1",
      request: { ...createImportRequest(), capturedText: "Different body" },
      now: new Date("2026-06-30T02:01:00.000Z"),
    });

    expect(result).toEqual({ ok: false, error: "idempotency_conflict" });
    expect(getCurrentDb().state.listingLeads[0]?.seenCount).toBe(1);
    expect(createRevisionMock).toHaveBeenCalledTimes(1);
  });
});

function createImportRequest(): FacebookListingImportRequest {
  return {
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    sourceSurface: "groupFeed",
    sourceGroupId: "12345",
    sourceGroupName: "SF Housing",
    sourceGroupUrl: "https://www.facebook.com/groups/12345",
    sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
    capturedText: "Room in Hayes Valley, $1800, available July 15.",
    capturedAt: "2026-06-30T02:00:00.000Z",
    parsedDraft: null,
    reviewedDetails: {
      listingType: "private_room",
      tenancyType: "sublet",
      priceMonthly: 1800,
      bedrooms: 2,
      bathroom: "shared",
      roommateCount: 2,
      locationText: "Hayes Valley",
      neighborhoodGuess: "Hayes Valley",
      availabilityStart: "2026-07-15",
      availabilityEnd: "2026-10-15",
      dateFlexibility: "flexible",
      durationText: "3 months",
      furnished: true,
      pets: "unknown",
      notes: ["Utilities not confirmed"],
    },
    incompleteFlags: [],
  };
}

function getCurrentDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

function createFacebookImportDbMock() {
  let leadIdSequence = 0;
  let captureIdSequence = 0;
  let attemptIdSequence = 0;
  let committedState = {
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: new Date("2026-06-23T11:00:00.000Z"),
      updatedAt: new Date("2026-06-23T11:00:00.000Z"),
    },
    listingLeads: [] as ListingLeadRow[],
    facebookListingCaptures: [] as FacebookListingCaptureRow[],
    facebookListingImportAttempts: [] as FacebookListingImportAttemptRow[],
  };
  let transactionalState = committedState;

  const tx = {
    query: {
      facebookListingImportAttempts: {
        findFirst: async ({ where }: { where: unknown }) =>
          transactionalState.facebookListingImportAttempts.find((row) =>
            matchesCondition(row, where),
          ),
      },
      listingLeads: {
        findFirst: async ({ where }: { where: unknown }) =>
          transactionalState.listingLeads.find((row) => matchesCondition(row, where)),
      },
      facebookListingCaptures: {
        findFirst: async ({ where }: { where: unknown }) =>
          transactionalState.facebookListingCaptures.find((row) => matchesCondition(row, where)),
      },
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: unknown) {
              if (table === workspaces) {
                if (!matchesCondition(transactionalState.workspace, condition)) {
                  return { returning: async () => [] };
                }

                transactionalState.workspace = {
                  ...transactionalState.workspace,
                  ...values,
                };

                return { returning: async () => [transactionalState.workspace] };
              }

              if (table === listingLeads) {
                const index = transactionalState.listingLeads.findIndex((row) =>
                  matchesCondition(row, condition),
                );

                if (index === -1) {
                  return { returning: async () => [] };
                }

                const updated = {
                  ...transactionalState.listingLeads[index],
                  ...values,
                } as ListingLeadRow;
                transactionalState.listingLeads[index] = updated;

                return { returning: async () => [updated] };
              }

              if (table === facebookListingCaptures) {
                const index = transactionalState.facebookListingCaptures.findIndex((row) =>
                  matchesCondition(row, condition),
                );

                if (index === -1) {
                  return { returning: async () => [] };
                }

                const updated = {
                  ...transactionalState.facebookListingCaptures[index],
                  ...values,
                } as FacebookListingCaptureRow;
                transactionalState.facebookListingCaptures[index] = updated;

                return { returning: async () => [updated] };
              }

              throw new Error("Unexpected table");
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          if (table === listingLeads) {
            leadIdSequence += 1;
            const row = {
              ...value,
              id: `lead-${leadIdSequence}`,
            } as ListingLeadRow;
            transactionalState.listingLeads.push(row);

            return { returning: async () => [row] };
          }

          if (table === facebookListingCaptures) {
            captureIdSequence += 1;
            const row = {
              ...value,
              id: `facebook-capture-${captureIdSequence}`,
            } as FacebookListingCaptureRow;
            transactionalState.facebookListingCaptures.push(row);

            return { returning: async () => [row] };
          }

          if (table === facebookListingImportAttempts) {
            attemptIdSequence += 1;
            const row = {
              ...value,
              id: `facebook-import-attempt-${attemptIdSequence}`,
            } as FacebookListingImportAttemptRow;
            transactionalState.facebookListingImportAttempts.push(row);

            return { returning: async () => [row] };
          }

          throw new Error("Unexpected table");
        },
      };
    },
  };

  return {
    get state() {
      return committedState;
    },
    async transaction<T>(callback: (innerTx: typeof tx) => Promise<T>) {
      transactionalState = structuredClone(committedState);

      try {
        const result = await callback(tx);
        committedState = transactionalState;
        return result;
      } finally {
        transactionalState = committedState;
      }
    },
  };
}

type ListingLeadRow = typeof listingLeads.$inferSelect;
type FacebookListingCaptureRow = typeof facebookListingCaptures.$inferSelect;
type FacebookListingImportAttemptRow = typeof facebookListingImportAttempts.$inferSelect;

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

  return true;
}

function readColumnValue(record: Record<string, unknown>, column: unknown) {
  switch (column) {
    case workspaces.id:
      return record.id;
    case listingLeads.id:
    case facebookListingImportAttempts.listingLeadId:
    case facebookListingCaptures.listingLeadId:
      return record.id;
    case workspaces.listingLedgerRevision:
      return record.listingLedgerRevision;
    case listingLeads.workspaceId:
    case facebookListingCaptures.workspaceId:
    case facebookListingImportAttempts.workspaceId:
      return record.workspaceId;
    case listingLeads.canonicalUrl:
      return record.canonicalUrl;
    case facebookListingCaptures.sourcePostUrl:
      return record.sourcePostUrl;
    case facebookListingImportAttempts.idempotencyKey:
      return record.idempotencyKey;
    default:
      return undefined;
  }
}
