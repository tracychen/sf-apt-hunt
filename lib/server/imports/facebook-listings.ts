import "server-only";

import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import {
  facebookListingCaptures,
  facebookListingImportAttempts,
  listingLeads,
  workspaces,
} from "@/lib/db/schema";
import { createRevision } from "@/lib/db/workspace-revisions";
import type {
  FacebookListingImportRequest,
  FacebookListingImportResponse,
  HousingDetails,
  ListingCandidate,
} from "@/lib/domain/types";
import { serializeListingLead } from "@/lib/server/listing-leads/serialize";

type ListingLeadRow = typeof listingLeads.$inferSelect;
type FacebookListingCaptureRow = typeof facebookListingCaptures.$inferSelect;

type FacebookImportTransaction = {
  query: {
    facebookListingImportAttempts: {
      findFirst(input: { where: unknown }): Promise<
        | {
            payloadHash: string;
            listingLeadId: string;
            successfulResponse: {
              captureId: string;
              listingLedgerRevision: string;
            };
          }
        | undefined
      >;
    };
    listingLeads: {
      findFirst(input: { where: unknown }): Promise<ListingLeadRow | undefined>;
    };
    facebookListingCaptures: {
      findFirst(input: { where: unknown }): Promise<FacebookListingCaptureRow | undefined>;
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): {
        returning(): Promise<unknown[]>;
      };
    };
  };
  insert(table: unknown): {
    values(value: Record<string, unknown>): {
      returning(): Promise<unknown[]>;
    };
  };
};

const FACEBOOK_IMPORT_QUERY = "Facebook listing import";

export function normalizeFacebookListingCandidate(
  request: FacebookListingImportRequest,
): ListingCandidate {
  const details = request.reviewedDetails ?? request.parsedDraft;
  const price = details?.priceMonthly ?? null;
  const location = details?.locationText ?? null;
  const neighborhood = details?.neighborhoodGuess || "Unknown";
  const caveats = [
    ...(details?.notes ?? []),
    ...request.incompleteFlags,
    ...(request.reviewedDetails ? [] : ["Saved from an incomplete Facebook review."]),
  ];

  return {
    id: `facebook-${stableSuffix(request.sourcePostUrl)}`,
    title: buildFacebookTitle(details),
    url: request.sourcePostUrl,
    sourceDomain: "facebook.com",
    neighborhoodGuess: neighborhood,
    locationText: location,
    geocodeQuery: location,
    locationConfidence: location ? "medium" : "low",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: price,
    beds: mapBedrooms(details),
    shortTermSignal: details
      ? details.tenancyType === "sublet" ||
        details.tenancyType === "month_to_month" ||
        Boolean(details.availabilityEnd)
      : false,
    furnishedSignal: details?.furnished === true,
    fitScore: 3,
    whyItFits: "Saved manually from an allowlisted Facebook housing group.",
    citations: [
      {
        url: request.sourcePostUrl,
        title: request.sourceGroupName,
        sourceDomain: "facebook.com",
      },
    ],
    caveats,
  };
}

function buildFacebookTitle(details: HousingDetails | null | undefined) {
  if (!details) {
    return "Facebook listing";
  }

  const price = details.priceMonthly ? `$${details.priceMonthly.toLocaleString()}` : null;
  const type = details.listingType === "private_room" ? "private room" : details.listingType;
  const location =
    details.neighborhoodGuess && details.neighborhoodGuess !== "Unknown"
      ? `in ${details.neighborhoodGuess}`
      : null;

  return [price, type === "unknown" ? "Facebook listing" : type.replaceAll("_", " "), location]
    .filter(Boolean)
    .join(" ");
}

function mapBedrooms(details: HousingDetails | null | undefined): ListingCandidate["beds"] {
  if (!details) {
    return "unknown";
  }

  if (details.bedrooms === "studio") {
    return "studio";
  }

  return details.bedrooms === 1 && details.listingType === "full_apartment" ? "1br" : "unknown";
}

function stableSuffix(value: string) {
  try {
    const postId = new URL(value).pathname.match(/\/posts\/([^/]+)/)?.[1];

    return postId ?? value;
  } catch {
    return value;
  }
}

export async function importFacebookListing(input: {
  workspaceId: string;
  request: FacebookListingImportRequest;
  now?: Date;
}): Promise<FacebookListingImportResponse> {
  const now = input.now ?? new Date();
  const payloadHash = hashPayload(input.request);
  const database = requireDb();

  return database.transaction(async (tx) => {
    const importTx = tx as unknown as FacebookImportTransaction;
    const existingAttempt = await importTx.query.facebookListingImportAttempts.findFirst({
      where: and(
        eq(facebookListingImportAttempts.workspaceId, input.workspaceId),
        eq(facebookListingImportAttempts.idempotencyKey, input.request.idempotencyKey),
      ),
    });

    if (existingAttempt) {
      if (existingAttempt.payloadHash !== payloadHash) {
        return { ok: false, error: "idempotency_conflict" };
      }

      const lead = await importTx.query.listingLeads.findFirst({
        where: eq(listingLeads.id, existingAttempt.listingLeadId),
      });

      if (!lead) {
        return { ok: false, error: "import_failed" };
      }

      return {
        ok: true,
        captureId: existingAttempt.successfulResponse.captureId,
        lead: serializeListingLead(lead),
        listingLedgerRevision: existingAttempt.successfulResponse.listingLedgerRevision,
      };
    }

    const [workspace] = (await importTx
      .update(workspaces)
      .set({ listingLedgerRevision: createRevision("ledger"), updatedAt: now })
      .where(eq(workspaces.id, input.workspaceId))
      .returning()) as Array<typeof workspaces.$inferSelect>;

    if (!workspace) {
      return { ok: false, error: "import_failed" };
    }

    const candidate = normalizeFacebookListingCandidate(input.request);
    const canonicalUrl = canonicalizeFacebookListingUrl(input.request.sourcePostUrl);
    const existingLead = await importTx.query.listingLeads.findFirst({
      where: and(
        eq(listingLeads.workspaceId, input.workspaceId),
        eq(listingLeads.canonicalUrl, canonicalUrl),
      ),
    });
    const lead = existingLead
      ? await updateExistingLead(importTx, existingLead, candidate, now)
      : await insertNewLead(importTx, input.workspaceId, canonicalUrl, candidate, now);

    const capture = await upsertCapture(importTx, input.workspaceId, input.request, lead.id, now);
    await importTx.insert(facebookListingImportAttempts).values({
      id: `facebook-import-attempt-${randomUUID()}`,
      workspaceId: input.workspaceId,
      idempotencyKey: input.request.idempotencyKey,
      payloadHash,
      captureId: capture.id,
      listingLeadId: lead.id,
      successfulResponse: {
        captureId: capture.id,
        leadCanonicalUrl: lead.canonicalUrl,
        listingLedgerRevision: workspace.listingLedgerRevision,
      },
      createdAt: now,
    });

    return {
      ok: true,
      captureId: capture.id,
      lead: serializeListingLead(lead),
      listingLedgerRevision: workspace.listingLedgerRevision,
    };
  });
}

async function insertNewLead(
  tx: FacebookImportTransaction,
  workspaceId: string,
  canonicalUrl: string,
  candidate: ListingCandidate,
  now: Date,
) {
  const [lead] = (await tx
    .insert(listingLeads)
    .values({
      id: `listing-lead-${randomUUID()}`,
      workspaceId,
      canonicalUrl,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSearchQuery: FACEBOOK_IMPORT_QUERY,
      seenCount: 1,
      status: "saved",
      candidate: {
        ...candidate,
        url: canonicalUrl,
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning()) as ListingLeadRow[];

  if (!lead) {
    throw new Error("Facebook listing lead was not persisted.");
  }

  return lead;
}

async function updateExistingLead(
  tx: FacebookImportTransaction,
  existingLead: ListingLeadRow,
  candidate: ListingCandidate,
  now: Date,
) {
  const [lead] = (await tx
    .update(listingLeads)
    .set({
      lastSeenAt: now,
      lastSearchQuery: FACEBOOK_IMPORT_QUERY,
      seenCount: existingLead.seenCount + 1,
      status: "saved",
      candidate: {
        ...candidate,
        url: existingLead.canonicalUrl,
      },
      updatedAt: now,
    })
    .where(
      and(
        eq(listingLeads.workspaceId, existingLead.workspaceId),
        eq(listingLeads.canonicalUrl, existingLead.canonicalUrl),
      ),
    )
    .returning()) as ListingLeadRow[];

  if (!lead) {
    throw new Error("Facebook listing lead was not updated.");
  }

  return lead;
}

async function upsertCapture(
  tx: FacebookImportTransaction,
  workspaceId: string,
  request: FacebookListingImportRequest,
  listingLeadId: string,
  now: Date,
) {
  const existingCapture = await tx.query.facebookListingCaptures.findFirst({
    where: and(
      eq(facebookListingCaptures.workspaceId, workspaceId),
      eq(facebookListingCaptures.sourcePostUrl, request.sourcePostUrl),
    ),
  });
  const values = {
    sourceSurface: request.sourceSurface,
    sourceGroupId: request.sourceGroupId,
    sourceGroupName: request.sourceGroupName,
    sourceGroupUrl: request.sourceGroupUrl,
    sourcePostUrl: request.sourcePostUrl,
    capturedText: request.capturedText,
    capturedAt: new Date(request.capturedAt),
    parsedDraft: request.parsedDraft,
    reviewedDetails: request.reviewedDetails,
    incompleteFlags: request.incompleteFlags,
    listingLeadId,
    updatedAt: now,
  };
  const [capture] = existingCapture
    ? ((await tx
        .update(facebookListingCaptures)
        .set(values)
        .where(
          and(
            eq(facebookListingCaptures.workspaceId, workspaceId),
            eq(facebookListingCaptures.sourcePostUrl, request.sourcePostUrl),
          ),
        )
        .returning()) as FacebookListingCaptureRow[])
    : ((await tx
        .insert(facebookListingCaptures)
        .values({
          id: `facebook-capture-${randomUUID()}`,
          workspaceId,
          ...values,
          createdAt: now,
        })
        .returning()) as FacebookListingCaptureRow[]);

  if (!capture) {
    throw new Error("Facebook listing capture was not persisted.");
  }

  return capture;
}

function canonicalizeFacebookListingUrl(url: string) {
  return url.trim();
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
