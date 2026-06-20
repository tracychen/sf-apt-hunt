import type { ListingCandidate, ListingLead } from "@/lib/domain/types";

export function buildSeenListingLead(input: {
  candidate: ListingCandidate;
  searchQuery: string;
  now: string;
}): ListingLead {
  const canonicalUrl = input.candidate.url.trim();
  const candidate = {
    ...input.candidate,
    url: canonicalUrl,
  };

  return {
    canonicalUrl,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    lastSearchQuery: input.searchQuery,
    seenCount: 1,
    status: "seen",
    candidate,
  };
}

export function mergeReappearingListingLead(
  existing: ListingLead | null,
  seenLead: ListingLead,
): ListingLead {
  if (!existing) {
    return seenLead;
  }

  return {
    canonicalUrl: seenLead.canonicalUrl,
    firstSeenAt: existing.firstSeenAt,
    lastSeenAt: seenLead.lastSeenAt,
    lastSearchQuery: seenLead.lastSearchQuery,
    seenCount: Math.max(existing.seenCount, 0) + 1,
    status:
      existing.status === "saved" || existing.status === "dismissed" ? existing.status : "seen",
    candidate: seenLead.candidate,
  };
}
