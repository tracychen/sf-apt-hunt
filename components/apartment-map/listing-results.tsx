"use client";

import type { ListingCandidate, SourceCitation } from "@/lib/domain/types";

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

export function ListingResults({
  listings,
  sourceCaveats,
  sourceCitations,
  sourceSummary,
}: {
  listings: ListingCandidate[];
  sourceSummary: string | null;
  sourceCitations: SourceCitation[];
  sourceCaveats: string[];
}) {
  return (
    <section className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Listing results</h2>
        <span className="text-xs text-muted-foreground">{listings.length} candidates</span>
      </div>

      {sourceSummary ? (
        <div className="border border-sidebar-border bg-background p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Source summary</p>
          <p className="mt-1 leading-5">{sourceSummary}</p>

          {sourceCaveats.length > 0 ? (
            <ul className="mt-2 space-y-1 leading-4">
              {sourceCaveats.map((caveat, index) => (
                <li key={`source-caveat-${index}`}>Caveat: {caveat}</li>
              ))}
            </ul>
          ) : null}

          {sourceCitations.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {sourceCitations.map((citation, index) => (
                <a
                  key={`source-citation-${index}`}
                  className="text-primary underline underline-offset-4 hover:text-primary/80"
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {citation.title ?? citation.sourceDomain}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {listings.length === 0 ? (
        <p className="border border-dashed border-sidebar-border bg-background p-3 text-xs text-muted-foreground">
          {sourceSummary ? "No listing candidates returned." : "No listing candidates yet."}
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
