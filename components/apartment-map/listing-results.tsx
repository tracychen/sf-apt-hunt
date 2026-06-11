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
                <span>{listing.beds}</span>
                <span>{listing.neighborhoodGuess}</span>
              </div>

              <p className="mt-2 text-xs leading-5 text-muted-foreground">{listing.whyItFits}</p>

              {listing.caveats.length > 0 ? (
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  Caveat: {listing.caveats[0]}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
