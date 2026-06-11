"use client";

import type { ListingCandidate } from "@/lib/domain/types";

function formatPrice(priceMonthly: number | null) {
  if (priceMonthly === null) {
    return "Price unknown";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(priceMonthly);
}

function formatBeds(beds: ListingCandidate["beds"]) {
  if (beds === "1br") {
    return "1BR";
  }

  if (beds === "studio") {
    return "Studio";
  }

  return "Beds unknown";
}

function formatPinStatus(listing: ListingCandidate) {
  if (listing.coordinates) {
    return listing.markerPrecision === "exact" ? "Exact pin" : "Approximate pin";
  }

  if (listing.geocodeStatus === "failed") {
    return "Pin unavailable";
  }

  if (listing.geocodeStatus === "outside_sf") {
    return "Outside SF";
  }

  return "Pin pending";
}

export function ListingResults({ listings }: { listings: ListingCandidate[] }) {
  return (
    <section className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Listing results</h2>
        <span className="text-xs text-muted-foreground">{listings.length} candidates</span>
      </div>

      {listings.length === 0 ? (
        <p className="border border-dashed border-sidebar-border bg-background p-3 text-xs text-muted-foreground">
          No listing candidates yet.
        </p>
      ) : (
        <div className="space-y-2">
          {listings.map((listing) => (
            <article key={listing.id} className="border border-sidebar-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <a
                  className="font-medium underline underline-offset-4 hover:text-primary"
                  href={listing.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {listing.title}
                </a>
                <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {listing.sourceDomain}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{formatPrice(listing.priceMonthly)}</span>
                <span>{formatBeds(listing.beds)}</span>
                <span>{listing.neighborhoodGuess}</span>
                <span>Fit {listing.fitScore}/5</span>
                <span>{formatPinStatus(listing)}</span>
              </div>

              <p className="mt-2 text-xs leading-5 text-muted-foreground">{listing.whyItFits}</p>

              {listing.caveats.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px] leading-4 text-muted-foreground">
                  {listing.caveats.map((caveat, index) => (
                    <li key={`${listing.id}-caveat-${index}`}>Caveat: {caveat}</li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {listing.citations.map((citation, index) => (
                  <a
                    key={`${listing.id}-citation-${index}`}
                    className="text-primary underline underline-offset-4 hover:text-primary/80"
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {citation.title ?? citation.sourceDomain}
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
