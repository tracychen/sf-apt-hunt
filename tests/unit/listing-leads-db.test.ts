import { beforeEach, describe, expect, test, vi } from "vitest";

import { geocodeCacheEntries, listingLeads, workspaces } from "@/lib/db/schema";
import type { ListingCandidate, ListingLeadStatus } from "@/lib/domain/types";

const createRevisionMock = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof createListingLeadsDbMock> | null,
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
  listWorkspaceListingLeads,
  updateWorkspaceListingStatus,
  upsertWorkspaceGeocodeResult,
} from "@/lib/server/listing-leads-db";

describe("listing-leads-db", () => {
  beforeEach(() => {
    dbMock.current = createListingLeadsDbMock();
    createRevisionMock.mockReset();
  });

  test("lists serialized workspace leads with the current listing ledger revision", async () => {
    const result = await listWorkspaceListingLeads("workspace-1");

    expect(result).toEqual({
      leads: [
        {
          canonicalUrl: "https://example.com/listing",
          firstSeenAt: "2026-06-23T11:00:00.000Z",
          lastSeenAt: "2026-06-23T11:30:00.000Z",
          lastSearchQuery: "mission studio",
          seenCount: 2,
          status: "seen",
          candidate: createCandidate(),
        },
      ],
      listingLedgerRevision: "ledger-1",
    });
  });

  test("rejects stale listing status updates", async () => {
    const result = await updateWorkspaceListingStatus({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-stale",
      status: "saved",
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_listing_ledger_revision",
      currentListingLedgerRevision: "ledger-1",
    });
    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-1");
    expect(getCurrentDb().state.lead.status).toBe("seen");
  });

  test("updates listing status and advances the ledger revision together", async () => {
    createRevisionMock.mockReturnValueOnce("ledger-2");

    const result = await updateWorkspaceListingStatus({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-1",
      status: "saved",
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      lead: {
        canonicalUrl: "https://example.com/listing",
        firstSeenAt: "2026-06-23T11:00:00.000Z",
        lastSeenAt: "2026-06-23T11:30:00.000Z",
        lastSearchQuery: "mission studio",
        seenCount: 2,
        status: "saved",
        candidate: createCandidate(),
      },
      listingLedgerRevision: "ledger-2",
    });
    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-2");
    expect(getCurrentDb().state.lead.status).toBe("saved");
  });

  test("does not dismiss a saved listing through the normal dismiss path", async () => {
    getCurrentDb().state.lead.status = "saved";

    const result = await updateWorkspaceListingStatus({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-1",
      status: "dismissed",
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: "listing_not_found",
    });
    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-1");
    expect(getCurrentDb().state.lead.status).toBe("saved");
  });

  test("geocode writes update cache and listing candidate together", async () => {
    createRevisionMock.mockReturnValueOnce("ledger-2");

    const result = await upsertWorkspaceGeocodeResult({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-1",
      queryHash: "query-hash-1",
      query: "123 Main St San Francisco CA",
      result: {
        coordinates: [-122.42, 37.77],
        geocodeQuery: "123 Main St San Francisco CA",
        geocodeStatus: "geocoded_exact",
        locationConfidence: "high",
        markerPrecision: "exact",
        locationText: "123 Main St",
        neighborhoodGuess: "Mission",
      },
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      lead: {
        canonicalUrl: "https://example.com/listing",
        firstSeenAt: "2026-06-23T11:00:00.000Z",
        lastSeenAt: "2026-06-23T11:30:00.000Z",
        lastSearchQuery: "mission studio",
        seenCount: 2,
        status: "seen",
        candidate: {
          ...createCandidate(),
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
      },
      cacheEntry: {
        id: "cache-1",
        workspaceId: "workspace-1",
        queryHash: "query-hash-1",
        query: "123 Main St San Francisco CA",
        result: {
          coordinates: [-122.42, 37.77],
          geocodeQuery: "123 Main St San Francisco CA",
          geocodeStatus: "geocoded_exact",
          locationConfidence: "high",
          markerPrecision: "exact",
          locationText: "123 Main St",
          neighborhoodGuess: "Mission",
        },
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:00:00.000Z",
      },
      listingLedgerRevision: "ledger-2",
    });
    expect(getCurrentDb().state.workspace.listingLedgerRevision).toBe("ledger-2");
    expect(getCurrentDb().state.lead.candidate.coordinates).toEqual([-122.42, 37.77]);
    expect(getCurrentDb().state.cacheEntry?.queryHash).toBe("query-hash-1");
  });
});

function getCurrentDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

function createListingLeadsDbMock() {
  let cacheIdSequence = 0;
  let committedState = {
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: new Date("2026-06-23T11:00:00.000Z"),
      updatedAt: new Date("2026-06-23T11:00:00.000Z"),
    },
    lead: createLeadRow(),
    cacheEntry: null as null | {
      id: string;
      workspaceId: string;
      queryHash: string;
      query: string;
      result: {
        coordinates: [number, number] | null;
        geocodeQuery: string | null;
        geocodeStatus: ListingCandidate["geocodeStatus"];
        locationConfidence: ListingCandidate["locationConfidence"];
        markerPrecision: ListingCandidate["markerPrecision"];
        locationText: string | null;
        neighborhoodGuess: string;
      };
      createdAt: Date;
      updatedAt: Date;
    },
  };
  let transactionalState = committedState;

  const tx = {
    query: {
      workspaces: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(transactionalState.workspace, where)
            ? transactionalState.workspace
            : undefined,
      },
      listingLeads: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(transactionalState.lead, where) ? transactionalState.lead : undefined,
        findMany: async ({ where }: { where: unknown }) =>
          matchesCondition(transactionalState.lead, where) ? [transactionalState.lead] : [],
      },
      geocodeCacheEntries: {
        findFirst: async ({ where }: { where: unknown }) =>
          transactionalState.cacheEntry && matchesCondition(transactionalState.cacheEntry, where)
            ? transactionalState.cacheEntry
            : undefined,
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
                if (!matchesCondition(transactionalState.lead, condition)) {
                  return { returning: async () => [] };
                }

                transactionalState.lead = {
                  ...transactionalState.lead,
                  ...values,
                };

                return { returning: async () => [transactionalState.lead] };
              }

              if (table === geocodeCacheEntries) {
                if (!transactionalState.cacheEntry || !matchesCondition(transactionalState.cacheEntry, condition)) {
                  return { returning: async () => [] };
                }

                transactionalState.cacheEntry = {
                  ...transactionalState.cacheEntry,
                  ...values,
                };

                return { returning: async () => [transactionalState.cacheEntry] };
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
          if (table !== geocodeCacheEntries) {
            throw new Error("Unexpected table");
          }

          cacheIdSequence += 1;
          transactionalState.cacheEntry = {
            id: `cache-${cacheIdSequence}`,
            workspaceId: value.workspaceId as string,
            queryHash: value.queryHash as string,
            query: value.query as string,
            result: value.result as {
              coordinates: [number, number] | null;
              geocodeQuery: string | null;
              geocodeStatus: ListingCandidate["geocodeStatus"];
              locationConfidence: ListingCandidate["locationConfidence"];
              markerPrecision: ListingCandidate["markerPrecision"];
              locationText: string | null;
              neighborhoodGuess: string;
            },
            createdAt: value.createdAt as Date,
            updatedAt: value.updatedAt as Date,
          };

          return {
            returning: async () => [transactionalState.cacheEntry],
          };
        },
      };
    },
  };

  return {
    query: {
      workspaces: {
        findFirst: async ({ where }: { where: unknown }) =>
          matchesCondition(committedState.workspace, where) ? committedState.workspace : undefined,
      },
      listingLeads: {
        findMany: async ({ where }: { where: unknown }) =>
          matchesCondition(committedState.lead, where) ? [committedState.lead] : [],
      },
    },
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

function createCandidate(): ListingCandidate {
  return {
    id: "candidate-1",
    title: "Sunny studio near Dolores",
    url: "https://example.com/listing",
    sourceDomain: "example.com",
    neighborhoodGuess: "Mission Dolores",
    locationText: "Dolores St",
    geocodeQuery: null,
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2900,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 4,
    whyItFits: "Walkable to the gym and under budget.",
    citations: [
      {
        url: "https://example.com/listing",
        title: "Listing",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };
}

function createLeadRow() {
  return {
    id: "lead-1",
    workspaceId: "workspace-1",
    canonicalUrl: "https://example.com/listing",
    firstSeenAt: new Date("2026-06-23T11:00:00.000Z"),
    lastSeenAt: new Date("2026-06-23T11:30:00.000Z"),
    lastSearchQuery: "mission studio",
    seenCount: 2,
    status: "seen" as ListingLeadStatus,
    candidate: createCandidate(),
    createdAt: new Date("2026-06-23T11:00:00.000Z"),
    updatedAt: new Date("2026-06-23T11:30:00.000Z"),
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

  return true;
}

function readColumnValue(record: Record<string, unknown>, column: unknown) {
  switch (column) {
    case workspaces.id:
    case listingLeads.id:
    case geocodeCacheEntries.id:
      return record.id;
    case workspaces.listingLedgerRevision:
      return record.listingLedgerRevision;
    case listingLeads.workspaceId:
    case geocodeCacheEntries.workspaceId:
      return record.workspaceId;
    case listingLeads.canonicalUrl:
      return record.canonicalUrl;
    case geocodeCacheEntries.queryHash:
      return record.queryHash;
    default:
      return undefined;
  }
}
