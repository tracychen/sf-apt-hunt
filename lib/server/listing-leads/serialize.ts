import type { ListingLead } from "@/lib/domain/types";

export function serializeListingLead(lead: {
  canonicalUrl: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  lastSearchQuery: string;
  seenCount: number;
  status: ListingLead["status"];
  candidate: ListingLead["candidate"];
}): ListingLead {
  return {
    canonicalUrl: lead.canonicalUrl,
    firstSeenAt: toIsoString(lead.firstSeenAt),
    lastSeenAt: toIsoString(lead.lastSeenAt),
    lastSearchQuery: lead.lastSearchQuery,
    seenCount: lead.seenCount,
    status: lead.status,
    candidate: {
      ...lead.candidate,
      url: lead.canonicalUrl,
    },
  };
}

export function toIsoString(value: Date | string) {
  return typeof value === "string" ? value : value.toISOString();
}
