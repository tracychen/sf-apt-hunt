# Listing Search Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist listing leads locally and display deterministic map-aware planning scores using richer target, corridor, and zone context.

**Architecture:** Keep OpenAI listing search as the lead discovery layer, but move durable lead tracking and planning score computation into local TypeScript modules. Add a dedicated listing ledger storage wrapper, a deterministic scoring helper, richer listing-search request context, and thin UI wiring that persists geocode updates back to the ledger.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, Zod, browser localStorage wrappers, OpenAI Responses hosted web search, Google geocoding route, Vitest, Playwright.

---

## File Structure

- `lib/domain/types.ts`: add shared listing-search filter, listing lead, planning signal, and display candidate types.
- `lib/domain/schemas.ts`: add Zod schemas for persisted listing leads and strict filter/context validation helpers where needed.
- `lib/storage/listing-ledger-storage.ts`: own `sf-apt-hunt:listing-ledger:v1`, canonical URL keys, merge/update/clear helpers, and storage failure handling.
- `lib/map/listing-planning-score.ts`: own Haversine distance, point-to-corridor distance, score math, signal selection, and result ordering.
- `components/apartment-map/assistant-panel.tsx`: send richer selected context and pass the listing request query/filters back to the app.
- `app/api/ai/listing-search/route.ts`: validate richer selected context and tell the model target coordinates are `[longitude, latitude]`.
- `components/apartment-map/apartment-map-app.tsx`: merge search results into the ledger, enrich displayed listings, clear ledger on local reset, and persist geocode updates back to the ledger.
- `components/apartment-map/listing-results.tsx`: render lead status, planning score, and planning signals.
- `components/apartment-map/leaflet-map.tsx`, `components/apartment-map/sidebar.tsx`: accept the display candidate type where needed; it extends the current listing candidate shape.
- Tests:
  - `tests/unit/listing-ledger-storage.test.ts`
  - `tests/unit/listing-planning-score.test.ts`
  - `tests/routes/listing-search-route.test.ts`
  - `tests/e2e/apartment-map.spec.ts`

Before editing Next.js route or client component code, read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`, per this repo's AGENTS instructions.

---

### Task 1: Listing Ledger Types and Storage

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Create: `lib/storage/listing-ledger-storage.ts`
- Create: `tests/unit/listing-ledger-storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `tests/unit/listing-ledger-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ListingCandidate } from "@/lib/domain/types";
import {
  canonicalizeListingUrl,
  clearListingLedger,
  loadListingLedger,
  mergeListingCandidatesIntoLedger,
  saveListingLedger,
  updateListingLeadCandidate,
} from "@/lib/storage/listing-ledger-storage";

const listingLedgerStorageKey = "sf-apt-hunt:listing-ledger:v1";

class FakeStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("storage unavailable");
  }

  clear(): void {
    throw new Error("storage unavailable");
  }

  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  key(): string | null {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

function createCandidate(index: number, url = `https://example.com/listings/${index}`): ListingCandidate {
  return {
    id: `candidate-${index}`,
    title: `Candidate ${index}`,
    url,
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "Fillmore and California",
    geocodeQuery: "Fillmore and California",
    locationConfidence: "medium",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: 2800,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 4,
    whyItFits: "Under budget near a planning anchor.",
    citations: [
      {
        url,
        title: `Listing ${index}`,
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
  };
}

describe("listing ledger storage", () => {
  it("canonicalizes listing URLs by removing hash and tracking params", () => {
    expect(
      canonicalizeListingUrl(
        " https://example.com/listings/1?utm_source=test&gclid=abc&unit=2#photos ",
      ),
    ).toBe("https://example.com/listings/1?unit=2");
    expect(canonicalizeListingUrl("not a url")).toBe("not a url");
  });

  it("merges a new candidate as a new lead", () => {
    const localStorage = new FakeStorage();
    const result = mergeListingCandidatesIntoLedger({
      candidates: [createCandidate(1)],
      query: "Find studios near Fillmore",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]).toMatchObject({
      canonicalUrl: "https://example.com/listings/1",
      firstSeenAt: "2026-06-16T12:00:00.000Z",
      lastSeenAt: "2026-06-16T12:00:00.000Z",
      lastSearchQuery: "Find studios near Fillmore",
      seenCount: 1,
      status: "new",
      candidate: createCandidate(1),
    });
    expect(loadListingLedger(localStorage)["https://example.com/listings/1"]).toEqual(result.leads[0]);
  });

  it("merges an existing candidate as seen and updates the latest candidate", () => {
    const localStorage = new FakeStorage();
    mergeListingCandidatesIntoLedger({
      candidates: [createCandidate(1)],
      query: "First search",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    const updatedCandidate = {
      ...createCandidate(1, "https://example.com/listings/1?utm_source=repeat"),
      priceMonthly: 2750,
    };
    const result = mergeListingCandidatesIntoLedger({
      candidates: [updatedCandidate],
      query: "Second search",
      now: "2026-06-16T13:00:00.000Z",
      storage: localStorage,
    });

    expect(result.leads[0]).toMatchObject({
      canonicalUrl: "https://example.com/listings/1",
      firstSeenAt: "2026-06-16T12:00:00.000Z",
      lastSeenAt: "2026-06-16T13:00:00.000Z",
      lastSearchQuery: "Second search",
      seenCount: 2,
      status: "seen",
    });
    expect(result.leads[0]?.candidate.priceMonthly).toBe(2750);
  });

  it("ignores invalid ledger entries when loading", () => {
    const localStorage = new FakeStorage();
    const validLead = {
      canonicalUrl: "https://example.com/listings/1",
      firstSeenAt: "2026-06-16T12:00:00.000Z",
      lastSeenAt: "2026-06-16T12:00:00.000Z",
      lastSearchQuery: "Find studios",
      seenCount: 1,
      status: "new",
      candidate: createCandidate(1),
    };
    localStorage.setItem(
      listingLedgerStorageKey,
      JSON.stringify({
        "https://example.com/listings/1": validLead,
        "https://example.com/listings/2": {
          ...validLead,
          canonicalUrl: "https://example.com/listings/2",
          seenCount: 0,
        },
      }),
    );

    expect(loadListingLedger(localStorage)).toEqual({
      "https://example.com/listings/1": validLead,
    });
  });

  it("caps the ledger to the 500 most recently seen leads", () => {
    const localStorage = new FakeStorage();
    const candidates = Array.from({ length: 520 }, (_, index) =>
      createCandidate(index, `https://example.com/listings/${index}`),
    );

    mergeListingCandidatesIntoLedger({
      candidates,
      query: "Bulk search",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    const ledger = loadListingLedger(localStorage);
    expect(Object.keys(ledger)).toHaveLength(500);
    expect(ledger["https://example.com/listings/0"]).toBeUndefined();
    expect(ledger["https://example.com/listings/19"]).toBeUndefined();
    expect(ledger["https://example.com/listings/20"]).toBeDefined();
    expect(ledger["https://example.com/listings/519"]).toBeDefined();
  });

  it("updates geocoded candidate fields back into the matching lead", () => {
    const localStorage = new FakeStorage();
    mergeListingCandidatesIntoLedger({
      candidates: [createCandidate(1)],
      query: "Find studios",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    updateListingLeadCandidate(
      "https://example.com/listings/1",
      {
        ...createCandidate(1),
        coordinates: [-122.433, 37.789],
        geocodeStatus: "geocoded_exact",
        markerPrecision: "exact",
      },
      localStorage,
    );

    expect(loadListingLedger(localStorage)["https://example.com/listings/1"]?.candidate).toMatchObject({
      coordinates: [-122.433, 37.789],
      geocodeStatus: "geocoded_exact",
      markerPrecision: "exact",
    });
  });

  it("clears the listing ledger", () => {
    const localStorage = new FakeStorage();
    saveListingLedger(
      {
        "https://example.com/listings/1": {
          canonicalUrl: "https://example.com/listings/1",
          firstSeenAt: "2026-06-16T12:00:00.000Z",
          lastSeenAt: "2026-06-16T12:00:00.000Z",
          lastSearchQuery: "Find studios",
          seenCount: 1,
          status: "new",
          candidate: createCandidate(1),
        },
      },
      localStorage,
    );

    clearListingLedger(localStorage);

    expect(localStorage.getItem(listingLedgerStorageKey)).toBeNull();
    expect(loadListingLedger(localStorage)).toEqual({});
  });

  it("does not throw without available storage", () => {
    expect(loadListingLedger()).toEqual({});
    expect(() => saveListingLedger({})).not.toThrow();
    expect(() => clearListingLedger()).not.toThrow();
  });

  it("fails closed when storage methods throw", () => {
    const localStorage = new ThrowingStorage();
    expect(loadListingLedger(localStorage)).toEqual({});
    expect(() => saveListingLedger({}, localStorage)).not.toThrow();
    expect(() => clearListingLedger(localStorage)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the storage test to verify RED**

Run:

```bash
npm run test -- tests/unit/listing-ledger-storage.test.ts
```

Expected: fail because `@/lib/storage/listing-ledger-storage` does not exist.

- [ ] **Step 3: Add shared listing lead types**

In `lib/domain/types.ts`, add this after `ListingCandidate`:

```ts
export type ListingSearchFilters = {
  maxBudget: number | null;
  beds: "any" | "studio" | "1br";
  timing: string;
  shortTerm: boolean;
  furnished: boolean;
};

export type ListingLeadStatus = "new" | "seen";

export type ListingLead = {
  canonicalUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSearchQuery: string;
  seenCount: number;
  status: ListingLeadStatus;
  candidate: ListingCandidate;
};

export type ListingLedger = Record<string, ListingLead>;

export type ListingPlanningSignal = {
  label: string;
  delta: number;
};

export type ListingDisplayCandidate = ListingCandidate & {
  canonicalUrl: string;
  leadStatus: ListingLeadStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  planningScore: Score;
  planningSignals: string[];
};
```

- [ ] **Step 4: Add listing lead schemas**

In `lib/domain/schemas.ts`, import `ListingLead` and add these exports after `listingCandidateSchema`:

```ts
export const listingSearchFiltersSchema = z.object({
  maxBudget: z.number().int().positive().nullable(),
  beds: z.enum(["any", "studio", "1br"]),
  timing: textSchema,
  shortTerm: z.boolean(),
  furnished: z.boolean(),
});

export const listingLeadStatusSchema = z.enum(["new", "seen"]);

export const listingLeadSchema: z.ZodType<ListingLead> = z.object({
  canonicalUrl: urlSchema,
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  lastSearchQuery: textSchema,
  seenCount: z.number().int().positive(),
  status: listingLeadStatusSchema,
  candidate: listingCandidateSchema,
});
```

- [ ] **Step 5: Implement listing ledger storage**

Create `lib/storage/listing-ledger-storage.ts`:

```ts
import { listingLeadSchema } from "@/lib/domain/schemas";
import type { ListingCandidate, ListingLead, ListingLedger } from "@/lib/domain/types";

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
      if (key.toLowerCase().startsWith("utm_") || trackingParams.has(key.toLowerCase())) {
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

  const parsed = parseJson(rawLedger.value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, ListingLead] => {
      const result = listingLeadSchema.safeParse(entry[1]);
      return result.success && result.data.canonicalUrl === entry[0];
    }),
  );
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
  const leads = candidates.map((candidate) => {
    const canonicalUrl = canonicalizeListingUrl(candidate.url);
    const existingLead = ledger[canonicalUrl];
    const lead: ListingLead = existingLead
      ? {
          ...existingLead,
          lastSeenAt: now,
          lastSearchQuery: query,
          seenCount: existingLead.seenCount + 1,
          status: "seen",
          candidate: { ...candidate, url: canonicalUrl },
        }
      : {
          canonicalUrl,
          firstSeenAt: now,
          lastSeenAt: now,
          lastSearchQuery: query,
          seenCount: 1,
          status: "new",
          candidate: { ...candidate, url: canonicalUrl },
        };

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

  const nextLead = {
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
  const keptEntries = entries
    .sort((left, right) => {
      const timeDelta = Date.parse(right.lead.lastSeenAt) - Date.parse(left.lead.lastSeenAt);
      return timeDelta === 0 ? right.index - left.index : timeDelta;
    })
    .slice(0, MAX_LISTING_LEDGER_ENTRIES)
    .reverse();
  return Object.fromEntries(keptEntries.map((entry) => [entry.key, entry.lead]));
}
```

- [ ] **Step 6: Run the storage test to verify GREEN**

Run:

```bash
npm run test -- tests/unit/listing-ledger-storage.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/domain/types.ts lib/domain/schemas.ts lib/storage/listing-ledger-storage.ts tests/unit/listing-ledger-storage.test.ts
git commit -m "Add local listing lead ledger"
```

---

### Task 2: Deterministic Listing Planning Score

**Files:**
- Create: `lib/map/listing-planning-score.ts`
- Create: `tests/unit/listing-planning-score.test.ts`

- [ ] **Step 1: Write failing scoring tests**

Create `tests/unit/listing-planning-score.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type {
  ListingCandidate,
  ListingLead,
  ListingSearchFilters,
  MapState,
} from "@/lib/domain/types";
import {
  compareListingDisplayCandidates,
  haversineDistanceMeters,
  pointToLineStringDistanceMeters,
  scoreListingLead,
} from "@/lib/map/listing-planning-score";

const filters: ListingSearchFilters = {
  maxBudget: 3000,
  beds: "studio",
  timing: "",
  shortTerm: false,
  furnished: false,
};

const mapState: MapState = {
  zones: [
    {
      id: "lower-pac-heights",
      name: "Lower Pac Heights",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.44, 37.79],
            [-122.42, 37.79],
            [-122.42, 37.78],
            [-122.44, 37.78],
            [-122.44, 37.79],
          ],
        ],
      },
      fitnessScore: 5,
      affordabilityScore: 4,
      carFreeScore: 5,
      notes: ["Strong planning fit."],
    },
  ],
  corridors: [
    {
      id: "fillmore",
      name: "Fillmore",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.433, 37.784],
          [-122.433, 37.792],
        ],
      },
      priority: "high",
      tags: ["transit"],
      notes: ["Core route."],
    },
  ],
  targets: [
    {
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "favorite block",
      coordinates: [-122.433, 37.789],
      priority: "high",
      influence: "positive",
      radiusMinutes: 10,
      notes: ["Anchor this area."],
    },
    {
      id: "avoid-point",
      name: "Avoid Point",
      purpose: "noise pocket",
      coordinates: [-122.421, 37.758],
      priority: "high",
      influence: "negative",
      radiusMinutes: 5,
      notes: [],
    },
  ],
};

function createCandidate(overrides: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    id: "candidate-1",
    title: "Sunny Fillmore Studio",
    url: "https://example.com/listings/1",
    sourceDomain: "example.com",
    neighborhoodGuess: "Lower Pac Heights",
    locationText: "Fillmore and California",
    geocodeQuery: "Fillmore and California",
    locationConfidence: "medium",
    coordinates: [-122.433, 37.789],
    geocodeStatus: "geocoded_exact",
    markerPrecision: "exact",
    priceMonthly: 2800,
    beds: "studio",
    shortTermSignal: false,
    furnishedSignal: false,
    fitScore: 4,
    whyItFits: "Under budget near a planning anchor.",
    citations: [
      {
        url: "https://example.com/listings/1",
        title: "Listing 1",
        sourceDomain: "example.com",
      },
    ],
    caveats: [],
    ...overrides,
  };
}

function createLead(overrides: Partial<ListingLead> = {}): ListingLead {
  const candidate = createCandidate();
  return {
    canonicalUrl: candidate.url,
    firstSeenAt: "2026-06-16T12:00:00.000Z",
    lastSeenAt: "2026-06-16T12:00:00.000Z",
    lastSearchQuery: "Find studios",
    seenCount: 1,
    status: "new",
    candidate,
    ...overrides,
  };
}

describe("listing planning score", () => {
  it("computes distance between nearby coordinates in meters", () => {
    expect(haversineDistanceMeters([-122.433, 37.789], [-122.433, 37.79])).toBeCloseTo(111, -1);
  });

  it("computes distance from a point to a corridor segment", () => {
    expect(
      pointToLineStringDistanceMeters([-122.433, 37.789], {
        type: "LineString",
        coordinates: [
          [-122.433, 37.784],
          [-122.433, 37.792],
        ],
      }),
    ).toBeLessThan(5);
  });

  it("rewards budget, bed, positive target, corridor, selected zone, and exact pin signals", () => {
    const scored = scoreListingLead({
      lead: createLead(),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });

    expect(scored.planningScore).toBe(5);
    expect(scored.planningSignals).toEqual([
      "Near favorite block",
      "Within budget",
      "Matches bed filter",
    ]);
  });

  it("penalizes over-budget and negative target proximity", () => {
    const scored = scoreListingLead({
      lead: createLead({
        candidate: createCandidate({
          priceMonthly: 3400,
          coordinates: [-122.421, 37.758],
          neighborhoodGuess: "Unknown",
        }),
      }),
      filters,
      mapState,
      selectedZoneIds: [],
    });

    expect(scored.planningScore).toBe(1);
    expect(scored.planningSignals).toEqual([
      "Over budget",
      "Near avoided noise pocket",
      "Matches bed filter",
    ]);
  });

  it("scores ungeocoded candidates with location confidence signal", () => {
    const scored = scoreListingLead({
      lead: createLead({
        candidate: createCandidate({
          coordinates: null,
          geocodeStatus: "not_attempted",
          markerPrecision: "none",
          priceMonthly: null,
          beds: "unknown",
        }),
      }),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });

    expect(scored.planningScore).toBe(3);
    expect(scored.planningSignals).toEqual([
      "Location not pinned yet",
      "Matches selected zone",
      "Bed count unclear",
    ]);
  });

  it("sorts by planning score, new status, last seen time, then title", () => {
    const top = scoreListingLead({
      lead: createLead({ status: "seen", candidate: createCandidate({ title: "Top" }) }),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });
    const newLead = scoreListingLead({
      lead: createLead({
        canonicalUrl: "https://example.com/listings/2",
        status: "new",
        candidate: createCandidate({ id: "candidate-2", title: "New", url: "https://example.com/listings/2" }),
      }),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });
    const seenLead = scoreListingLead({
      lead: createLead({
        canonicalUrl: "https://example.com/listings/3",
        status: "seen",
        lastSeenAt: "2026-06-16T13:00:00.000Z",
        candidate: createCandidate({ id: "candidate-3", title: "Seen", url: "https://example.com/listings/3" }),
      }),
      filters,
      mapState,
      selectedZoneIds: ["lower-pac-heights"],
    });

    expect([seenLead, top, newLead].sort(compareListingDisplayCandidates).map((listing) => listing.title)).toEqual([
      "New",
      "Seen",
      "Top",
    ]);
  });
});
```

- [ ] **Step 2: Run the scoring test to verify RED**

Run:

```bash
npm run test -- tests/unit/listing-planning-score.test.ts
```

Expected: fail because `@/lib/map/listing-planning-score` does not exist.

- [ ] **Step 3: Implement scoring helper**

Create `lib/map/listing-planning-score.ts`:

```ts
import type {
  Coordinate,
  LineStringGeometry,
  ListingDisplayCandidate,
  ListingLead,
  ListingPlanningSignal,
  ListingSearchFilters,
  MapState,
  Priority,
  Score,
} from "@/lib/domain/types";
import { targetRadiusMeters } from "@/lib/map/target-points";

const EARTH_RADIUS_METERS = 6_371_000;
const CORRIDOR_RADIUS_METERS = 400;

const priorityWeights: Record<Priority, number> = {
  high: 1,
  medium: 0.6,
  low: 0.3,
};

const signalOrder = [
  "budget",
  "beds",
  "negative-target",
  "positive-target",
  "corridor",
  "selected-zone",
  "location",
] as const;

type SignalKind = (typeof signalOrder)[number];

type WeightedSignal = ListingPlanningSignal & {
  kind: SignalKind;
};

type ScoreListingLeadOptions = {
  lead: ListingLead;
  filters: ListingSearchFilters;
  mapState: MapState;
  selectedZoneIds: string[];
};

export function scoreListingLead({
  lead,
  filters,
  mapState,
  selectedZoneIds,
}: ScoreListingLeadOptions): ListingDisplayCandidate {
  const signals = [
    readBudgetSignal(lead.candidate.priceMonthly, filters.maxBudget),
    readBedSignal(lead.candidate.beds, filters.beds),
    readTargetSignal(lead, mapState, "positive-target"),
    readTargetSignal(lead, mapState, "negative-target"),
    readCorridorSignal(lead, mapState),
    readSelectedZoneSignal(lead.candidate.neighborhoodGuess, mapState, selectedZoneIds),
    readLocationSignal(lead),
  ].filter((signal): signal is WeightedSignal => signal !== null);

  const score = clampScore(
    Math.round(3 + signals.reduce((total, signal) => total + signal.delta, 0)),
  );

  return {
    ...lead.candidate,
    canonicalUrl: lead.canonicalUrl,
    leadStatus: lead.status,
    firstSeenAt: lead.firstSeenAt,
    lastSeenAt: lead.lastSeenAt,
    seenCount: lead.seenCount,
    planningScore: score,
    planningSignals: signals
      .filter((signal) => signal.label.length > 0)
      .sort(compareSignals)
      .slice(0, 3)
      .map((signal) => signal.label),
  };
}

export function compareListingDisplayCandidates(
  left: ListingDisplayCandidate,
  right: ListingDisplayCandidate,
) {
  const scoreDelta = right.planningScore - left.planningScore;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  if (left.leadStatus !== right.leadStatus) {
    return left.leadStatus === "new" ? -1 : 1;
  }

  const seenDelta = Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
  if (seenDelta !== 0) {
    return seenDelta;
  }

  return left.title.localeCompare(right.title);
}

export function haversineDistanceMeters(left: Coordinate, right: Coordinate) {
  const lat1 = toRadians(left[1]);
  const lat2 = toRadians(right[1]);
  const deltaLat = toRadians(right[1] - left[1]);
  const deltaLng = toRadians(right[0] - left[0]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointToLineStringDistanceMeters(point: Coordinate, line: LineStringGeometry) {
  const segments = line.coordinates.slice(0, -1).map((start, index) => ({
    start,
    end: line.coordinates[index + 1],
  }));

  if (segments.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(
    ...segments.map((segment) => {
      if (!segment.end) {
        return Number.POSITIVE_INFINITY;
      }
      return pointToSegmentDistanceMeters(point, segment.start, segment.end);
    }),
  );
}

function readBudgetSignal(priceMonthly: number | null, maxBudget: number | null): WeightedSignal | null {
  if (maxBudget === null && priceMonthly !== null) {
    return null;
  }

  if (priceMonthly === null) {
    return { kind: "budget", label: "Price needs verification", delta: 0 };
  }

  return priceMonthly <= maxBudget!
    ? { kind: "budget", label: "Within budget", delta: 0.7 }
    : { kind: "budget", label: "Over budget", delta: -1 };
}

function readBedSignal(
  candidateBeds: "studio" | "1br" | "unknown",
  requestedBeds: "any" | "studio" | "1br",
): WeightedSignal | null {
  if (requestedBeds === "any") {
    return null;
  }

  if (candidateBeds === requestedBeds) {
    return { kind: "beds", label: "Matches bed filter", delta: 0.4 };
  }

  if (candidateBeds === "unknown") {
    return { kind: "beds", label: "Bed count unclear", delta: -0.2 };
  }

  return { kind: "beds", label: "Bed count mismatch", delta: -0.5 };
}

function readTargetSignal(
  lead: ListingLead,
  mapState: MapState,
  kind: "positive-target" | "negative-target",
): WeightedSignal | null {
  const coordinates = lead.candidate.coordinates;
  if (!coordinates) {
    return null;
  }

  const influence = kind === "positive-target" ? "positive" : "negative";
  const matches = mapState.targets
    .filter((target) => target.influence === influence)
    .map((target) => {
      const radius = targetRadiusMeters(target);
      const distance = haversineDistanceMeters(coordinates, target.coordinates);
      if (distance > radius) {
        return null;
      }

      const targetWeight = distance <= radius / 2 ? 0.8 : 0.4;
      const magnitude = targetWeight * priorityWeights[target.priority];
      return {
        kind,
        label: influence === "positive" ? `Near ${target.purpose}` : `Near avoided ${target.purpose}`,
        delta: influence === "positive" ? magnitude : -magnitude,
      } satisfies WeightedSignal;
    })
    .filter((signal): signal is WeightedSignal => signal !== null);

  return strongestSignal(matches);
}

function readCorridorSignal(lead: ListingLead, mapState: MapState): WeightedSignal | null {
  const coordinates = lead.candidate.coordinates;
  if (!coordinates) {
    return null;
  }

  const matches = mapState.corridors
    .map((corridor) => {
      const distance = pointToLineStringDistanceMeters(coordinates, corridor.geometry);
      if (distance > CORRIDOR_RADIUS_METERS) {
        return null;
      }

      return {
        kind: "corridor",
        label: `Near ${corridor.name}`,
        delta: 0.3 * priorityWeights[corridor.priority],
      } satisfies WeightedSignal;
    })
    .filter((signal): signal is WeightedSignal => signal !== null);

  return strongestSignal(matches);
}

function readSelectedZoneSignal(
  neighborhoodGuess: string,
  mapState: MapState,
  selectedZoneIds: string[],
): WeightedSignal | null {
  const selectedZoneSet = new Set(selectedZoneIds);
  const normalizedGuess = normalizeText(neighborhoodGuess);

  for (const zone of mapState.zones) {
    if (!selectedZoneSet.has(zone.id) || !normalizedGuess.includes(normalizeText(zone.name))) {
      continue;
    }

    const averageScore = (zone.fitnessScore + zone.affordabilityScore + zone.carFreeScore) / 3;
    if (averageScore >= 4) {
      return { kind: "selected-zone", label: "Matches selected zone", delta: 0.3 };
    }

    if (averageScore <= 2) {
      return { kind: "selected-zone", label: "Weak selected-zone fit", delta: -0.3 };
    }
  }

  return null;
}

function readLocationSignal(lead: ListingLead): WeightedSignal {
  if (!lead.candidate.coordinates) {
    return { kind: "location", label: "Location not pinned yet", delta: -0.4 };
  }

  if (lead.candidate.markerPrecision === "exact") {
    return { kind: "location", label: "Exact pin", delta: 0.2 };
  }

  return { kind: "location", label: "Approximate pin", delta: 0 };
}

function pointToSegmentDistanceMeters(point: Coordinate, start: Coordinate, end: Coordinate) {
  const projectedPoint = projectToMeters(point, point);
  const projectedStart = projectToMeters(start, point);
  const projectedEnd = projectToMeters(end, point);
  const segmentX = projectedEnd.x - projectedStart.x;
  const segmentY = projectedEnd.y - projectedStart.y;
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;

  if (segmentLengthSquared === 0) {
    return Math.hypot(projectedPoint.x - projectedStart.x, projectedPoint.y - projectedStart.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((projectedPoint.x - projectedStart.x) * segmentX +
        (projectedPoint.y - projectedStart.y) * segmentY) /
        segmentLengthSquared,
    ),
  );
  const closestX = projectedStart.x + t * segmentX;
  const closestY = projectedStart.y + t * segmentY;
  return Math.hypot(projectedPoint.x - closestX, projectedPoint.y - closestY);
}

function projectToMeters(coordinate: Coordinate, origin: Coordinate) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(toRadians(origin[1]));
  return {
    x: (coordinate[0] - origin[0]) * metersPerDegreeLng,
    y: (coordinate[1] - origin[1]) * metersPerDegreeLat,
  };
}

function compareSignals(left: WeightedSignal, right: WeightedSignal) {
  const magnitudeDelta = Math.abs(right.delta) - Math.abs(left.delta);
  if (magnitudeDelta !== 0) {
    return magnitudeDelta;
  }

  return signalOrder.indexOf(left.kind) - signalOrder.indexOf(right.kind);
}

function strongestSignal(signals: WeightedSignal[]) {
  return signals.sort(compareSignals)[0] ?? null;
}

function normalizeText(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function clampScore(value: number): Score {
  return Math.min(5, Math.max(1, value)) as Score;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
```

- [ ] **Step 4: Run the scoring test to verify GREEN**

Run:

```bash
npm run test -- tests/unit/listing-planning-score.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/map/listing-planning-score.ts tests/unit/listing-planning-score.test.ts
git commit -m "Add listing planning score helper"
```

---

### Task 3: Rich Listing Search Context

**Files:**
- Modify: `components/apartment-map/assistant-panel.tsx`
- Modify: `app/api/ai/listing-search/route.ts`
- Modify: `tests/routes/listing-search-route.test.ts`

- [ ] **Step 1: Read local Next.js docs before editing route/client files**

Run:

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
sed -n '1,160p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
```

Expected: docs are readable. Use them as the local source of truth for route handlers and client component boundaries.

- [ ] **Step 2: Write failing route tests**

In `tests/routes/listing-search-route.test.ts`, replace the `selectedContext` object in `"requires hosted web search and disables storage in the OpenAI request"` with:

```ts
selectedContext: {
  zones: [
    {
      id: "lower-pac-heights",
      name: "Lower Pac Heights",
      fitnessScore: 5,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Good Fillmore access."],
    },
  ],
  corridors: [
    {
      id: "fillmore",
      name: "Fillmore",
      priority: "high",
      tags: ["transit", "rent"],
      notes: ["Core north-south route."],
    },
  ],
  targets: [
    {
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "favorite block",
      coordinates: [-122.433, 37.789],
      priority: "high",
      influence: "positive",
      radiusMinutes: 10,
      notes: ["Use this as the search anchor."],
    },
  ],
},
```

Update the assertion for `userMessage.selectedContext` to equal the same object. Add these assertions after reading `developerPrompt` in `"instructs the model not to fabricate URLs or guess prices"`:

```ts
expect(developerPrompt).toContain("[longitude, latitude]");
expect(developerPrompt).toContain("target coordinates");
```

- [ ] **Step 3: Run route tests to verify RED**

Run:

```bash
npm run test -- tests/routes/listing-search-route.test.ts
```

Expected: fail because the strict route schema rejects `targets`, zone scores/notes, and corridor tags/notes, and because the developer prompt does not mention target coordinate ordering.

- [ ] **Step 4: Update route request schema and prompt**

In `app/api/ai/listing-search/route.ts`, add local schema helpers above `listingSearchRequestSchema`:

```ts
const priorityRequestSchema = z.enum(["high", "medium", "low"]);
const scoreRequestSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const coordinateRequestSchema = z.tuple([z.number(), z.number()]);
const noteRequestSchema = z.string().max(2_000);
```

Replace the `selectedContext` schema with:

```ts
selectedContext: z
  .object({
    zones: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          name: z.string().min(1).max(160),
          fitnessScore: scoreRequestSchema,
          affordabilityScore: scoreRequestSchema,
          carFreeScore: scoreRequestSchema,
          notes: z.array(noteRequestSchema).max(50),
        }),
      )
      .max(100)
      .optional(),
    corridors: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          name: z.string().min(1).max(160),
          priority: priorityRequestSchema,
          tags: z.array(z.enum(["fitness", "rent", "transit", "safety", "short-term"])).max(5),
          notes: z.array(noteRequestSchema).max(50),
        }),
      )
      .max(100)
      .optional(),
    targets: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          name: z.string().min(1).max(160),
          purpose: z.string().min(1).max(2_000),
          coordinates: coordinateRequestSchema,
          priority: priorityRequestSchema,
          influence: z.enum(["positive", "negative", "neutral"]),
          radiusMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
          notes: z.array(noteRequestSchema).max(50),
        }),
      )
      .max(200)
      .optional(),
  })
  .strict()
  .optional(),
```

Append this sentence to the developer prompt content:

```ts
"Target coordinates in selectedContext use [longitude, latitude]. Use them only as planning context; do not copy them as listing coordinates. "
```

Change the selected context fallback to include targets:

```ts
selectedContext: body.selectedContext ?? { zones: [], corridors: [], targets: [] },
```

- [ ] **Step 5: Update browser selected context builder**

In `components/apartment-map/assistant-panel.tsx`, replace `buildSelectedContext` with:

```ts
function buildSelectedContext(mapState: MapState, selectedZoneIds: string[]) {
  const selectedZoneSet = new Set(selectedZoneIds);

  return {
    zones: mapState.zones
      .filter((zone) => selectedZoneSet.has(zone.id))
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        fitnessScore: zone.fitnessScore,
        affordabilityScore: zone.affordabilityScore,
        carFreeScore: zone.carFreeScore,
        notes: zone.notes,
      })),
    corridors: mapState.corridors.map((corridor) => ({
      id: corridor.id,
      name: corridor.name,
      priority: corridor.priority,
      tags: corridor.tags,
      notes: corridor.notes,
    })),
    targets: mapState.targets.map((target) => ({
      id: target.id,
      name: target.name,
      purpose: target.purpose,
      coordinates: target.coordinates,
      priority: target.priority,
      influence: target.influence,
      radiusMinutes: target.radiusMinutes,
      notes: target.notes,
    })),
  };
}
```

- [ ] **Step 6: Run route tests to verify GREEN**

Run:

```bash
npm run test -- tests/routes/listing-search-route.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add components/apartment-map/assistant-panel.tsx app/api/ai/listing-search/route.ts tests/routes/listing-search-route.test.ts
git commit -m "Send richer listing search context"
```

---

### Task 4: Wire Ledger, Scoring, Geocode Persistence, and UI

**Files:**
- Modify: `components/apartment-map/assistant-panel.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `components/apartment-map/listing-results.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/leaflet-map.tsx`
- Modify: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Write failing e2e tests for lead status and planning score**

In `tests/e2e/apartment-map.spec.ts`, update the existing `"renders listing cards and geocodes authorized candidates"` test route assertion to expect richer context:

```ts
expect(body.selectedContext).toMatchObject({
  zones: [],
  corridors: expect.any(Array),
  targets: expect.any(Array),
});
expect(body.selectedContext.targets[0]).toEqual(
  expect.objectContaining({
    purpose: expect.any(String),
    coordinates: expect.any(Array),
    radiusMinutes: expect.any(Number),
  }),
);
```

Add these expectations after the existing card expectations in that test:

```ts
await expect(page.getByText("New lead")).toBeVisible();
await expect(page.getByText("Planning score 5/5")).toBeVisible();
await expect(page.getByText("Within budget")).toBeVisible();
```

Add a new test after it:

```ts
test("shows a repeated listing URL as seen before after reload", async ({ page }) => {
  await page.route("**/api/ai/listing-search", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [
          {
            id: "listing-1",
            title: "Repeat Fillmore Studio",
            url: "https://example.com/listings/repeat?utm_source=test",
            sourceDomain: "example.com",
            neighborhoodGuess: "Lower Pac Heights",
            locationText: "Fillmore and California",
            geocodeQuery: null,
            locationConfidence: "medium",
            coordinates: null,
            geocodeStatus: "not_attempted",
            markerPrecision: "none",
            priceMonthly: 2800,
            beds: "studio",
            shortTermSignal: false,
            furnishedSignal: false,
            fitScore: 4,
            whyItFits: "Under budget near the target corridor.",
            citations: [
              {
                url: "https://example.com/listings/repeat?utm_source=test",
                title: "Repeat listing",
                sourceDomain: "example.com",
              },
            ],
            caveats: [],
          },
        ],
        sourceSummary: "One listing matched.",
        citations: [],
        caveats: [],
        geocodeAuthorization: null,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Add OpenAI key" }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByLabel("Ask the assistant").fill("Find studio listing under 3000 near Fillmore");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("New lead")).toBeVisible();

  await page.reload();
  await page.getByLabel("Ask the assistant").fill("Find studio listing under 3000 near Fillmore");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Seen before")).toBeVisible();
  await expect(page.getByText("New lead")).toHaveCount(0);
});
```

- [ ] **Step 2: Run e2e tests to verify RED**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "listing"
```

Expected: fail because the UI does not render lead status/planning score and repeated leads are not persisted.

- [ ] **Step 3: Pass query and filters with listing responses**

In `components/apartment-map/assistant-panel.tsx`, import `ListingSearchFilters` and change `AssistantFilters` to:

```ts
type AssistantFilters = ListingSearchFilters;
```

Change the prop type:

```ts
onListingSearchResponse: (
  response: ListingSearchResponse,
  request: { query: string; filters: ListingSearchFilters },
) => void;
```

Change the listing response callback:

```ts
props.onListingSearchResponse(listingResponse, {
  query: trimmedMessage,
  filters: activeFilters,
});
```

- [ ] **Step 4: Wire display candidate types through map/sidebar/listing results**

In `components/apartment-map/apartment-map-app.tsx`, `components/apartment-map/sidebar.tsx`, and `components/apartment-map/leaflet-map.tsx`, replace listing state/prop imports and prop types from `ListingCandidate[]` to `ListingDisplayCandidate[]`.

The `LeafletMap` listing marker code can stay unchanged because `ListingDisplayCandidate` extends `ListingCandidate`.

- [ ] **Step 5: Integrate ledger merge, scoring, clear, and geocode persistence**

In `components/apartment-map/apartment-map-app.tsx`, import:

```ts
import type {
  Coordinate,
  GeocodeAuthorization,
  ListingCandidate,
  ListingDisplayCandidate,
  ListingLead,
  ListingSearchFilters,
  ListingSearchResponse,
  MapPatchProposal,
  MapState,
} from "@/lib/domain/types";
import {
  clearListingLedger,
  mergeListingCandidatesIntoLedger,
  updateListingLeadCandidate,
} from "@/lib/storage/listing-ledger-storage";
import {
  compareListingDisplayCandidates,
  scoreListingLead,
} from "@/lib/map/listing-planning-score";
```

Change listing state:

```ts
const [listings, setListings] = useState<ListingDisplayCandidate[]>([]);
```

In `resetLocalMap`, add:

```ts
clearListingLedger();
setListings([]);
setListingSearchMeta(null);
```

Change `handleListingSearchResponse` signature and body:

```ts
function handleListingSearchResponse(
  response: ListingSearchResponse,
  request: { query: string; filters: ListingSearchFilters },
) {
  const nextRunId = geocodeRunIdRef.current + 1;
  geocodeRunIdRef.current = nextRunId;
  geocodeAbortRef.current?.abort();
  const abortController = new AbortController();
  geocodeAbortRef.current = abortController;
  setListingSearchMeta({
    sourceSummary: response.sourceSummary,
    citations: response.citations,
    caveats: response.caveats,
  });

  const merged = mergeListingCandidatesIntoLedger({
    candidates: response.candidates,
    query: request.query,
    now: new Date().toISOString(),
  });
  const cachedResult = applyCachedGeocodeEntriesToLeads(merged.leads);
  setListings(scoreListingLeads(cachedResult.leads, request.filters, mapState, selectedZoneIds));

  if (!response.geocodeAuthorization) {
    return;
  }

  const candidatesToGeocode = selectCandidatesToGeocode(
    response.geocodeAuthorization,
    cachedResult.leads.map((lead) => lead.candidate),
    cachedResult.cachedCandidateIds,
  );

  if (candidatesToGeocode.length === 0) {
    return;
  }

  void geocodeListingCandidates({
    authorization: response.geocodeAuthorization,
    candidates: candidatesToGeocode,
    signal: abortController.signal,
    onResult: (candidateId, update) => {
      if (geocodeRunIdRef.current !== nextRunId) {
        return;
      }

      setListings((currentListings) => {
        const nextLeads = currentListings.map((listing) => {
          const lead = displayCandidateToLead(listing);
          if (listing.id !== candidateId) {
            return lead;
          }

          const updatedCandidate = { ...lead.candidate, ...update };
          updateListingLeadCandidate(lead.canonicalUrl, updatedCandidate);
          return { ...lead, candidate: updatedCandidate };
        });

        return scoreListingLeads(nextLeads, request.filters, mapState, selectedZoneIds);
      });
    },
  });
}
```

Replace `applyCachedGeocodeEntries` with a lead-based helper:

```ts
function applyCachedGeocodeEntriesToLeads(leads: ListingLead[]) {
  const cache = loadGeocodeCache();
  const cachedCandidateIds = new Set<string>();
  let changed = false;
  const cachedLeads = leads.map((lead) => {
    if (!lead.candidate.geocodeQuery) {
      return lead;
    }

    const cacheEntry = cache[canonicalizeGeocodeCacheQuery(lead.candidate.geocodeQuery)];
    if (!cacheEntry) {
      return lead;
    }

    cachedCandidateIds.add(lead.candidate.id);
    const cachedCandidate = applyCachedGeocodeEntry(lead.candidate, cacheEntry);
    changed = changed || cachedCandidate !== lead.candidate;
    const cachedLead = { ...lead, candidate: cachedCandidate };
    updateListingLeadCandidate(cachedLead.canonicalUrl, cachedCandidate);
    return cachedLead;
  });

  return {
    cachedCandidateIds,
    leads: cachedLeads,
    changed,
  };
}

function scoreListingLeads(
  leads: ListingLead[],
  filters: ListingSearchFilters,
  mapState: MapState,
  selectedZoneIds: string[],
) {
  return leads
    .map((lead) =>
      scoreListingLead({
        lead,
        filters,
        mapState,
        selectedZoneIds,
      }),
    )
    .sort(compareListingDisplayCandidates);
}

function displayCandidateToLead(candidate: ListingDisplayCandidate): ListingLead {
  return {
    canonicalUrl: candidate.canonicalUrl,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    lastSearchQuery: "",
    seenCount: candidate.seenCount,
    status: candidate.leadStatus,
    candidate,
  };
}
```

- [ ] **Step 6: Render lead metadata in listing cards**

In `components/apartment-map/listing-results.tsx`, change the import to `ListingDisplayCandidate` and update the props type:

```ts
import type { ListingDisplayCandidate, SourceCitation } from "@/lib/domain/types";
```

```ts
listings: ListingDisplayCandidate[];
```

Inside the badge row that currently renders price/beds/neighborhood/fit/pin, replace:

```tsx
<span>Fit {listing.fitScore}/5</span>
<span>{formatPinStatus(listing)}</span>
```

with:

```tsx
<span>{listing.leadStatus === "new" ? "New lead" : "Seen before"}</span>
<span>Planning score {listing.planningScore}/5</span>
<span>Fit {listing.fitScore}/5</span>
<span>{formatPinStatus(listing)}</span>
```

After the `whyItFits` paragraph, add:

```tsx
{listing.planningSignals.length > 0 ? (
  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
    {listing.planningSignals.map((signal) => (
      <span key={`${listing.id}-signal-${signal}`} className="border border-border px-1.5 py-0.5">
        {signal}
      </span>
    ))}
  </div>
) : null}
```

- [ ] **Step 7: Run focused tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/listing-ledger-storage.test.ts tests/unit/listing-planning-score.test.ts
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "listing"
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

```bash
git add components/apartment-map/assistant-panel.tsx components/apartment-map/apartment-map-app.tsx components/apartment-map/listing-results.tsx components/apartment-map/sidebar.tsx components/apartment-map/leaflet-map.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Track and score listing leads"
```

---

### Task 5: Final Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run route, unit, and e2e focused checks**

Run:

```bash
npm run test -- tests/routes/listing-search-route.test.ts tests/unit/listing-ledger-storage.test.ts tests/unit/listing-planning-score.test.ts
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "listing"
```

Expected: both commands pass.

- [ ] **Step 2: Run broad local verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: production build completes successfully.

- [ ] **Step 4: Record verification in final handoff**

Include the exact verification commands and whether each passed. If any command cannot run because of the local environment, include the command, the failure, and the reason.
