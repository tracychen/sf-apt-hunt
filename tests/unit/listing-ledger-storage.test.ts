import { describe, expect, it } from "vitest";

import type { ListingCandidate, ListingLead } from "@/lib/domain/types";
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

function createCandidate(
  index: number,
  url = `https://example.com/listings/${index}`,
): ListingCandidate {
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

function createLead(index: number, overrides: Partial<ListingLead> = {}): ListingLead {
  const canonicalUrl = `https://example.com/listings/${index}`;

  return {
    canonicalUrl,
    firstSeenAt: "2026-06-16T12:00:00.000Z",
    lastSeenAt: "2026-06-16T12:00:00.000Z",
    lastSearchQuery: "Find studios",
    seenCount: 1,
    status: "new",
    candidate: createCandidate(index, canonicalUrl),
    ...overrides,
  };
}

function expectedCappedListingKeys() {
  return Array.from(
    { length: 500 },
    (_, index) => `https://example.com/listings/${index + 20}`,
  );
}

describe("listing ledger storage", () => {
  it("canonicalizes listing URLs by removing hash and tracking params", () => {
    expect(
      canonicalizeListingUrl(
        " https://example.com/listings/1?utm_source=test&gclid=abc&unit=2#photos ",
      ),
    ).toBe("https://example.com/listings/1?unit=2");
    expect(
      canonicalizeListingUrl("https://example.com/listings/1?fbclid=abc&unit=2"),
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
    expect(loadListingLedger(localStorage)["https://example.com/listings/1"]).toEqual(
      result.leads[0],
    );
  });

  it("persists and reloads non-URL fallback canonical keys", () => {
    const localStorage = new FakeStorage();
    const fallbackCandidate = {
      ...createCandidate(1, "  Craigslist reply by email  "),
      citations: [
        {
          url: "https://example.com/listings/source",
          title: "Listing source",
          sourceDomain: "example.com",
        },
      ],
    };

    const result = mergeListingCandidatesIntoLedger({
      candidates: [fallbackCandidate],
      query: "Find studios from pasted leads",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    expect(result.leads[0]).toMatchObject({
      canonicalUrl: "Craigslist reply by email",
      candidate: {
        url: "Craigslist reply by email",
      },
    });
    expect(loadListingLedger(localStorage)).toEqual({
      "Craigslist reply by email": result.leads[0],
    });
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
    expect(result.leads[0]?.candidate.url).toBe("https://example.com/listings/1");
  });

  it("deduplicates new canonical URLs within a single merge batch", () => {
    const localStorage = new FakeStorage();
    const firstDuplicate = {
      ...createCandidate(1, "https://example.com/listings/1?utm_source=first"),
      priceMonthly: 2800,
    };
    const secondDuplicate = {
      ...createCandidate(3, "https://example.com/listings/1#photos"),
      priceMonthly: 2650,
    };
    const result = mergeListingCandidatesIntoLedger({
      candidates: [firstDuplicate, createCandidate(2), secondDuplicate],
      query: "Find studios near Fillmore",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    expect(result.leads.map((lead) => lead.canonicalUrl)).toEqual([
      "https://example.com/listings/1",
      "https://example.com/listings/2",
    ]);
    expect(result.leads[0]).toMatchObject({
      canonicalUrl: "https://example.com/listings/1",
      seenCount: 1,
      status: "new",
    });
    expect(result.leads[0]?.candidate).toMatchObject({
      id: "candidate-3",
      priceMonthly: 2650,
      url: "https://example.com/listings/1",
    });
    expect(
      loadListingLedger(localStorage)["https://example.com/listings/1"]?.candidate.id,
    ).toBe("candidate-3");
  });

  it("deduplicates existing canonical URLs within a single merge batch", () => {
    const localStorage = new FakeStorage();
    mergeListingCandidatesIntoLedger({
      candidates: [createCandidate(1)],
      query: "First search",
      now: "2026-06-16T12:00:00.000Z",
      storage: localStorage,
    });

    const firstDuplicate = {
      ...createCandidate(4, "https://example.com/listings/1?utm_source=repeat"),
      priceMonthly: 2750,
    };
    const secondDuplicate = {
      ...createCandidate(5, "https://example.com/listings/1#photos"),
      priceMonthly: 2600,
    };
    const result = mergeListingCandidatesIntoLedger({
      candidates: [firstDuplicate, createCandidate(2), secondDuplicate],
      query: "Second search",
      now: "2026-06-16T13:00:00.000Z",
      storage: localStorage,
    });

    expect(result.leads.map((lead) => lead.canonicalUrl)).toEqual([
      "https://example.com/listings/1",
      "https://example.com/listings/2",
    ]);
    expect(result.leads[0]).toMatchObject({
      canonicalUrl: "https://example.com/listings/1",
      firstSeenAt: "2026-06-16T12:00:00.000Z",
      lastSeenAt: "2026-06-16T13:00:00.000Z",
      lastSearchQuery: "Second search",
      seenCount: 2,
      status: "seen",
    });
    expect(result.leads[0]?.candidate).toMatchObject({
      id: "candidate-5",
      priceMonthly: 2600,
      url: "https://example.com/listings/1",
    });
    expect(loadListingLedger(localStorage)["https://example.com/listings/1"]).toMatchObject({
      seenCount: 2,
      candidate: {
        id: "candidate-5",
        priceMonthly: 2600,
      },
    });
  });

  it("ignores invalid ledger entries when loading", () => {
    const localStorage = new FakeStorage();
    const validLead = createLead(1);
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

  it("returns an empty ledger when stored JSON is invalid", () => {
    const localStorage = new FakeStorage();
    localStorage.setItem(listingLedgerStorageKey, "{not valid json");

    expect(loadListingLedger(localStorage)).toEqual({});
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
    expect(Object.keys(ledger)).toEqual(expectedCappedListingKeys());
    expect(ledger["https://example.com/listings/20"]).toBeDefined();
    expect(ledger["https://example.com/listings/519"]).toBeDefined();
  });

  it("caps an oversized persisted ledger when loading", () => {
    const localStorage = new FakeStorage();
    const storedLedger = Object.fromEntries(
      Array.from({ length: 520 }, (_, index) => {
        const lead = createLead(index);
        return [lead.canonicalUrl, lead];
      }),
    );
    localStorage.setItem(listingLedgerStorageKey, JSON.stringify(storedLedger));

    const ledger = loadListingLedger(localStorage);

    expect(Object.keys(ledger)).toEqual(expectedCappedListingKeys());
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

    const updatedLead = updateListingLeadCandidate(
      "https://example.com/listings/1#photos",
      {
        ...createCandidate(1),
        coordinates: [-122.433, 37.789],
        geocodeStatus: "geocoded_exact",
        markerPrecision: "exact",
      },
      localStorage,
    );

    expect(updatedLead?.candidate).toMatchObject({
      coordinates: [-122.433, 37.789],
      geocodeStatus: "geocoded_exact",
      markerPrecision: "exact",
    });
    expect(
      loadListingLedger(localStorage)["https://example.com/listings/1"]?.candidate,
    ).toMatchObject({
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
    expect(() =>
      mergeListingCandidatesIntoLedger({
        candidates: [createCandidate(1)],
        query: "Find studios",
        now: "2026-06-16T12:00:00.000Z",
      }),
    ).not.toThrow();
    expect(updateListingLeadCandidate("https://example.com/listings/1", createCandidate(1))).toBeNull();
  });

  it("fails closed when storage methods throw", () => {
    const localStorage = new ThrowingStorage();
    expect(loadListingLedger(localStorage)).toEqual({});
    expect(() => saveListingLedger({}, localStorage)).not.toThrow();
    expect(() => clearListingLedger(localStorage)).not.toThrow();
    expect(() =>
      mergeListingCandidatesIntoLedger({
        candidates: [createCandidate(1)],
        query: "Find studios",
        now: "2026-06-16T12:00:00.000Z",
        storage: localStorage,
      }),
    ).not.toThrow();
    expect(
      updateListingLeadCandidate("https://example.com/listings/1", createCandidate(1), localStorage),
    ).toBeNull();
  });
});
