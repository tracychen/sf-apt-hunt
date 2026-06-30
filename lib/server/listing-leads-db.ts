import "server-only";

import { and, eq } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import { geocodeCacheEntries, listingLeads, workspaces } from "@/lib/db/schema";
import { createRevision } from "@/lib/db/workspace-revisions";
import type {
  GeocodeCacheEntry,
  ListingsResponse,
  PatchListingResponse,
  PostGeocodeCacheRequest,
  PostGeocodeCacheResponse,
} from "@/lib/domain/types";
import { serializeListingLead, toIsoString } from "@/lib/server/listing-leads/serialize";

type ListingLeadRow = typeof listingLeads.$inferSelect;

class ListingLeadNotFoundError extends Error {
  constructor() {
    super("Listing lead was not found.");
  }
}

export async function listWorkspaceListingLeads(workspaceId: string): Promise<ListingsResponse> {
  const database = requireDb();
  const [workspace, leads] = await Promise.all([
    database.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    }),
    database.query.listingLeads.findMany({
      where: eq(listingLeads.workspaceId, workspaceId),
    }),
  ]);

  return {
    leads: leads
      .map(serializeListingLead)
      .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)),
    listingLedgerRevision: workspace?.listingLedgerRevision ?? "",
  };
}

export async function updateWorkspaceListingStatus(input: {
  workspaceId: string;
  canonicalUrl: string;
  expectedListingLedgerRevision: string;
  status: "saved" | "dismissed";
  now?: Date;
}): Promise<PatchListingResponse> {
  const database = requireDb();
  const now = input.now ?? new Date();

  try {
    return await database.transaction(async (tx) => {
      const [currentWorkspace, lead] = await Promise.all([
        tx.query.workspaces.findFirst({
          where: eq(workspaces.id, input.workspaceId),
        }),
        tx.query.listingLeads.findFirst({
          where: and(
            eq(listingLeads.workspaceId, input.workspaceId),
            eq(listingLeads.canonicalUrl, input.canonicalUrl),
          ),
        }),
      ]);

      if (currentWorkspace?.listingLedgerRevision !== input.expectedListingLedgerRevision) {
        return {
          ok: false,
          error: "stale_listing_ledger_revision" as const,
          currentListingLedgerRevision: currentWorkspace?.listingLedgerRevision ?? "",
        };
      }

      if (!lead) {
        throw new ListingLeadNotFoundError();
      }

      if (lead.status === "saved" && input.status === "dismissed") {
        throw new ListingLeadNotFoundError();
      }

      const nextRevision = createRevision("ledger");
      const [workspace] = await tx
        .update(workspaces)
        .set({
          listingLedgerRevision: nextRevision,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.listingLedgerRevision, input.expectedListingLedgerRevision),
          ),
        )
        .returning();

      if (!workspace) {
        const current = await tx.query.workspaces.findFirst({
          where: eq(workspaces.id, input.workspaceId),
        });

        return {
          ok: false,
          error: "stale_listing_ledger_revision" as const,
          currentListingLedgerRevision: current?.listingLedgerRevision ?? "",
        };
      }

      const [updatedLead] = await tx
        .update(listingLeads)
        .set({
          status: input.status,
          updatedAt: now,
        })
        .where(
          and(
            eq(listingLeads.workspaceId, input.workspaceId),
            eq(listingLeads.canonicalUrl, input.canonicalUrl),
          ),
        )
        .returning();

      if (!updatedLead) {
        throw new ListingLeadNotFoundError();
      }

      return {
        ok: true as const,
        lead: serializeListingLead(updatedLead),
        listingLedgerRevision: workspace.listingLedgerRevision,
      };
    });
  } catch (error) {
    if (error instanceof ListingLeadNotFoundError) {
      return { ok: false, error: "listing_not_found" };
    }

    throw error;
  }
}

export async function upsertWorkspaceGeocodeResult(input: {
  workspaceId: string;
  canonicalUrl: string;
  expectedListingLedgerRevision: string;
  queryHash: string;
  query: string;
  result: PostGeocodeCacheRequest["result"];
  now?: Date;
}): Promise<PostGeocodeCacheResponse> {
  const database = requireDb();
  const now = input.now ?? new Date();

  try {
    return await database.transaction(async (tx) => {
      const nextRevision = createRevision("ledger");
      const [workspace] = await tx
        .update(workspaces)
        .set({
          listingLedgerRevision: nextRevision,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.listingLedgerRevision, input.expectedListingLedgerRevision),
          ),
        )
        .returning();

      if (!workspace) {
        const current = await tx.query.workspaces.findFirst({
          where: eq(workspaces.id, input.workspaceId),
        });

        return {
          ok: false,
          error: "stale_listing_ledger_revision" as const,
          currentListingLedgerRevision: current?.listingLedgerRevision ?? "",
        };
      }

      const lead = await tx.query.listingLeads.findFirst({
        where: and(
          eq(listingLeads.workspaceId, input.workspaceId),
          eq(listingLeads.canonicalUrl, input.canonicalUrl),
        ),
      });

      if (!lead) {
        throw new ListingLeadNotFoundError();
      }

      const [updatedLead] = await tx
        .update(listingLeads)
        .set({
          candidate: mergeLeadCandidateGeocodeResult(lead, input.result),
          updatedAt: now,
        })
        .where(
          and(
            eq(listingLeads.workspaceId, input.workspaceId),
            eq(listingLeads.canonicalUrl, input.canonicalUrl),
          ),
        )
        .returning();

      if (!updatedLead) {
        throw new ListingLeadNotFoundError();
      }

      const existingCacheEntry = await tx.query.geocodeCacheEntries.findFirst({
        where: and(
          eq(geocodeCacheEntries.workspaceId, input.workspaceId),
          eq(geocodeCacheEntries.queryHash, input.queryHash),
        ),
      });

      const cacheEntry = existingCacheEntry
        ? (
            await tx
              .update(geocodeCacheEntries)
              .set({
                query: input.query,
                result: input.result,
                updatedAt: now,
              })
              .where(
                and(
                  eq(geocodeCacheEntries.workspaceId, input.workspaceId),
                  eq(geocodeCacheEntries.queryHash, input.queryHash),
                ),
              )
              .returning()
          )[0]
        : (
            await tx
              .insert(geocodeCacheEntries)
              .values({
                id: `cache-${crypto.randomUUID()}`,
                workspaceId: input.workspaceId,
                queryHash: input.queryHash,
                query: input.query,
                result: input.result,
                createdAt: now,
                updatedAt: now,
              })
              .returning()
          )[0];

      if (!cacheEntry) {
        throw new Error("Geocode cache entry was not persisted.");
      }

      return {
        ok: true as const,
        lead: serializeListingLead(updatedLead),
        cacheEntry: serializeGeocodeCacheEntry(cacheEntry),
        listingLedgerRevision: workspace.listingLedgerRevision,
      };
    });
  } catch (error) {
    if (error instanceof ListingLeadNotFoundError) {
      return { ok: false, error: "listing_not_found" };
    }

    throw error;
  }
}

function mergeLeadCandidateGeocodeResult(
  lead: Pick<ListingLeadRow, "canonicalUrl" | "candidate">,
  result: PostGeocodeCacheRequest["result"],
) {
  return {
    ...lead.candidate,
    url: lead.canonicalUrl,
    coordinates: result.coordinates,
    geocodeQuery: result.geocodeQuery,
    geocodeStatus: result.geocodeStatus,
    locationConfidence: result.locationConfidence,
    markerPrecision: result.markerPrecision,
    locationText: result.locationText,
    neighborhoodGuess: result.neighborhoodGuess,
  };
}

function serializeGeocodeCacheEntry(entry: {
  id: string;
  workspaceId: string;
  queryHash: string;
  query: string;
  result: GeocodeCacheEntry["result"];
  createdAt: Date | string;
  updatedAt: Date | string;
}): GeocodeCacheEntry {
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    queryHash: entry.queryHash,
    query: entry.query,
    result: entry.result,
    createdAt: toIsoString(entry.createdAt),
    updatedAt: toIsoString(entry.updatedAt),
  };
}
