import { listingLeadSchema } from "@/lib/domain/schemas";
import type {
  ListingCandidate,
  ListingLead,
  ListingLedger,
} from "@/lib/domain/types";

const listingLedgerStorageKey = "sf-apt-hunt:listing-ledger:v1";
const MAX_LISTING_LEDGER_ENTRIES = 500;
const trackingParams = new Set(["fbclid", "gclid"]);

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type MergeListingCandidatesOptions = {
  candidates: ListingCandidate[];
  query: string;
  now: string;
  storage?: StorageLike;
};

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveLocalStorage(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? getBrowserLocalStorage();
  } catch {
    return null;
  }
}

function safeGetItem(storage: StorageLike, key: string) {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeRemoveItem(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}

function safeSetItem(storage: StorageLike, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    return;
  }
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function canonicalizeListingUrl(url: string) {
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";

    for (const key of Array.from(parsed.searchParams.keys())) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || trackingParams.has(normalizedKey)) {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function loadListingLedger(storage?: StorageLike): ListingLedger {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return {};
  }

  const rawLedger = safeGetItem(localStorage, listingLedgerStorageKey);
  if (!rawLedger.ok || rawLedger.value === null) {
    return {};
  }

  const parsedLedger = parseJson(rawLedger.value);
  if (!parsedLedger || typeof parsedLedger !== "object" || Array.isArray(parsedLedger)) {
    return {};
  }

  const ledger: ListingLedger = Object.fromEntries(
    Object.entries(parsedLedger).flatMap(([key, value]) => {
      const result = listingLeadSchema.safeParse(value);
      if (!result.success || result.data.canonicalUrl !== key) {
        return [];
      }

      return [[key, result.data]];
    }),
  );

  return capListingLedger(ledger);
}

export function saveListingLedger(ledger: ListingLedger, storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  safeSetItem(localStorage, listingLedgerStorageKey, JSON.stringify(capListingLedger(ledger)));
}

export function clearListingLedger(storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  safeRemoveItem(localStorage, listingLedgerStorageKey);
}

export function mergeListingCandidatesIntoLedger({
  candidates,
  query,
  now,
  storage,
}: MergeListingCandidatesOptions) {
  const ledger = loadListingLedger(storage);
  const candidatesByCanonicalUrl = new Map<string, ListingCandidate>();

  for (const candidate of candidates) {
    const canonicalUrl = canonicalizeListingUrl(candidate.url);
    candidatesByCanonicalUrl.set(canonicalUrl, { ...candidate, url: canonicalUrl });
  }

  const leads = Array.from(candidatesByCanonicalUrl.entries()).map(([canonicalUrl, candidate]) => {
    const existingLead = ledger[canonicalUrl];
    const lead: ListingLead = existingLead
      ? {
          ...existingLead,
          lastSeenAt: now,
          lastSearchQuery: query,
          seenCount: existingLead.seenCount + 1,
          status: "seen",
          candidate,
        }
      : {
          canonicalUrl,
          firstSeenAt: now,
          lastSeenAt: now,
          lastSearchQuery: query,
          seenCount: 1,
          status: "new",
          candidate,
        };

    delete ledger[canonicalUrl];
    ledger[canonicalUrl] = lead;
    return lead;
  });

  const cappedLedger = capListingLedger(ledger);
  saveListingLedger(cappedLedger, storage);
  return { ledger: cappedLedger, leads };
}

export function updateListingLeadCandidate(
  url: string,
  candidate: ListingCandidate,
  storage?: StorageLike,
) {
  const canonicalUrl = canonicalizeListingUrl(url);
  const ledger = loadListingLedger(storage);
  const existingLead = ledger[canonicalUrl];

  if (!existingLead) {
    return null;
  }

  const nextLead: ListingLead = {
    ...existingLead,
    candidate: { ...candidate, url: canonicalUrl },
  };
  const nextLedger = {
    ...ledger,
    [canonicalUrl]: nextLead,
  };
  saveListingLedger(nextLedger, storage);
  return nextLead;
}

function capListingLedger(ledger: ListingLedger): ListingLedger {
  const entries = Object.entries(ledger).map(([key, lead], index) => ({
    key,
    lead,
    index,
  }));

  if (entries.length <= MAX_LISTING_LEDGER_ENTRIES) {
    return ledger;
  }

  const keptEntries = entries
    .sort((left, right) => {
      const timeDelta = Date.parse(right.lead.lastSeenAt) - Date.parse(left.lead.lastSeenAt);
      return timeDelta === 0 ? right.index - left.index : timeDelta;
    })
    .slice(0, MAX_LISTING_LEDGER_ENTRIES)
    .reverse();

  return Object.fromEntries(keptEntries.map((entry) => [entry.key, entry.lead]));
}
