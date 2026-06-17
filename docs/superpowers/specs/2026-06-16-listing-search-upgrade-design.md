# Listing Search Upgrade Design

## Goal

Turn listing search from a disposable AI response into a durable, map-aware lead workflow. A search should still use AI web search to find candidate listing pages, but the app should remember leads locally and score them against the user's planning anchors.

## Current State

The assistant routes listing-like prompts to `/api/ai/listing-search` using keyword matching. The browser sends the prompt, simple filters, selected zone names, and corridor `id`, `name`, and `priority`. The API calls OpenAI hosted `web_search` with `store: false` and a strict response JSON schema. The model must return real listing URLs, citations, caveats, price signals, bed signals, and a model-authored `fitScore`.

The route strips any model-supplied coordinates and mints a short-lived geocode authorization for up to ten geocodeable candidates. The client geocodes authorized candidates through `/api/geocode/listing`, caches geocode results locally, and renders listing cards/pins for the current session.

Listing candidates are not currently persisted as leads. Refreshing the page drops the current results. Target points are not included in listing-search context, so custom target `purpose`, `influence`, `priority`, and `radiusMinutes` do not affect search or scoring.

## Design

This feature has three parts:

1. **Durable local listing ledger**
   - Add a storage wrapper for `sf-apt-hunt:listing-ledger:v1`.
   - Store leads by canonical URL, not by model-generated candidate id.
   - Each lead stores the latest `ListingCandidate`, `canonicalUrl`, `firstSeenAt`, `lastSeenAt`, `lastSearchQuery`, `seenCount`, and `status`.
   - `status` is a local lifecycle label: `new` or `seen`.
   - A newly returned URL creates a `new` lead. A URL that already exists increments `seenCount`, updates `lastSeenAt`, replaces the latest candidate fields, and returns as `seen`.
   - This feature does not add background monitors or stale detection.

2. **Richer listing-search context**
   - Include target points in the request context sent from the browser:
     - `id`
     - `name`
     - `purpose`
     - `coordinates`
     - `priority`
     - `influence`
     - `radiusMinutes`
     - `notes`
   - Include corridor `tags` and `notes`, in addition to `id`, `name`, and `priority`.
   - Include selected zone scores and notes, in addition to `id` and `name`.
   - Update the route request Zod schema and route tests for the richer context.
   - Preserve the domain coordinate convention: target `coordinates` are `[lng, lat]`. The listing-search developer prompt must tell the model that target coordinates use `[longitude, latitude]`.
   - The OpenAI output JSON schema does not need new fields for this part; the model can use richer context to choose candidates and write `whyItFits`.

3. **Deterministic planning score**
   - Keep the model's `fitScore` and `whyItFits` as source/context evidence.
   - Add an app-computed `planningScore` and `planningSignals` for displayed leads.
   - Score starts at `3.0`, applies the deterministic adjustments below, then rounds to the nearest integer and clamps to `1..5`.
   - Use existing `targetRadiusMeters()` for target radius conversion. It maps minutes to meters at `80` meters/minute.
   - Use Haversine distance for point-to-point distance.
   - Add a geometry helper for point-to-corridor distance. It projects longitude/latitude to a local meter plane around the candidate coordinate, computes distance to each corridor segment, and uses the nearest segment distance.

| Factor | Rule | Delta | Signal |
| --- | --- | ---: | --- |
| Budget match | No `maxBudget` filter or candidate price unknown | `0` | `Price needs verification` only when price is unknown |
| Budget match | `priceMonthly <= maxBudget` | `+0.7` | `Within budget` |
| Budget match | `priceMonthly > maxBudget` | `-1.0` | `Over budget` |
| Bed match | Requested beds are `any` | `0` | none |
| Bed match | Candidate beds match requested `studio` or `1br` | `+0.4` | `Matches bed filter` |
| Bed match | Candidate beds are known and do not match requested beds | `-0.5` | `Bed count mismatch` |
| Bed match | Candidate beds are `unknown` and requested beds are not `any` | `-0.2` | `Bed count unclear` |
| Positive target proximity | Candidate has coordinates and is within a positive target's `targetRadiusMeters()` | `+targetWeight * priorityWeight` | `Near <target purpose>` |
| Negative target proximity | Candidate has coordinates and is within a negative target's `targetRadiusMeters()` | `-targetWeight * priorityWeight` | `Near avoided <target purpose>` |
| Neutral target proximity | Target influence is `neutral` | `0` | none |
| Corridor proximity | Candidate has coordinates and is within 400m of a corridor | `+0.3 * priorityWeight` | `Near <corridor name>` |
| Selected zone fit | Normalized `neighborhoodGuess` contains normalized selected zone name and that zone average score is `4` or higher | `+0.3` | `Matches selected zone` |
| Selected zone fit | Normalized `neighborhoodGuess` contains normalized selected zone name and that zone average score is `2` or lower | `-0.3` | `Weak selected-zone fit` |
| Location confidence | `markerPrecision` is `exact` | `+0.2` | `Exact pin` |
| Location confidence | `markerPrecision` is `approximate` | `0` | `Approximate pin` |
| Location confidence | Candidate has no coordinates | `-0.4` | `Location not pinned yet` |

   - `priorityWeight` is `1.0` for `high`, `0.6` for `medium`, and `0.3` for `low`.
   - `targetWeight` is `0.8` when the candidate is at or inside half the target radius, and `0.4` when the candidate is outside half the radius but still inside the full radius.
   - A selected zone's average score is `(fitnessScore + affordabilityScore + carFreeScore) / 3`.
   - Text normalization for selected zone matching lowercases text, trims leading/trailing whitespace, and collapses internal whitespace.
   - If multiple targets or corridors match, apply only the strongest positive target delta, strongest negative target delta, and strongest corridor delta.
   - `planningSignals` are the three strongest human-readable reasons by absolute delta. Ties break by this order: budget, beds, negative target, positive target, corridor, selected zone, location confidence.
   - Display ordering sorts by `planningScore` descending, then `status` with `new` before `seen`, then `lastSeenAt` descending, then title alphabetically.

## Data Flow

1. User sends a listing-like assistant request.
2. Browser sends prompt, filters, and richer selected map context to `/api/ai/listing-search`.
3. API validates the request, calls OpenAI hosted web search, validates strict structured output, strips coordinates, and returns candidates plus geocode authorization.
4. Client merges returned candidates into the local listing ledger.
5. Client enriches current results with ledger metadata and deterministic planning scores.
6. Client applies cached geocode entries immediately, then geocodes authorized candidates.
7. Each geocode result updates the displayed candidate, writes the updated candidate back to the matching ledger lead, and re-runs deterministic scoring for that candidate.

## Storage

Add storage helpers in `lib/storage/` or the existing storage wrapper module. Feature code must not touch `window.localStorage` directly.

The ledger parser must be tolerant of corrupt or outdated entries:

- Invalid ledger payload returns an empty ledger.
- Invalid individual entries are ignored.
- Ledger is capped to 500 leads.
- Canonical URL normalization removes URL hash fragments and common tracking query params such as `utm_*`, `fbclid`, and `gclid`.
- If URL parsing fails, use the raw candidate URL as the key after trimming.
- The existing local reset/clear map flow also clears the listing ledger. The product remains local-first, so clearing local map data removes stored listing URLs and timestamps too.
- Geocoded coordinates and geocode status are persisted in the lead's latest `ListingCandidate`. The geocode cache remains the reusable source for geocode lookup by query, but the ledger is self-describing enough to render a saved lead accurately after reload.

## UI

Listing cards stay compact. Add small metadata badges rather than a new management screen:

- `New lead` or `Seen before`
- `Planning score N/5`
- Existing geocode precision label
- Up to three `planningSignals`

The listing count continues to describe the current search result count, not total ledger size. A full saved-leads browser is out of scope.

## Error Handling

- If ledger storage fails, the current search still displays in memory.
- If scoring cannot use location data, it returns a valid score and a clear signal such as `Location not pinned yet`.
- If richer context validation fails at the route, keep returning the existing `Invalid listing search request` response shape.
- Geocoding failures do not remove or invalidate leads.

## Testing

Unit tests should cover:

- Canonical URL generation removes hash and tracking params.
- Merging a new candidate creates a `new` lead with `seenCount` 1.
- Merging an existing candidate updates `lastSeenAt`, increments `seenCount`, and marks it `seen`.
- Invalid ledger entries are ignored on load.
- Ledger cap keeps the most recent entries.
- Clearing local map state also clears the listing ledger.
- Geocode updates persist back to the matching ledger lead.
- Planning score rewards budget match, requested bed match, positive target proximity, and corridor proximity.
- Planning score penalizes over-budget candidates and negative target proximity.
- Ungeocoded candidates still receive a clamped score and a location confidence signal.
- Planning signal tie-breaking follows the documented order.

Route tests should cover:

- Listing search request schema accepts target coordinates/notes, corridor tags/notes, and selected zone scores/notes.
- The OpenAI request includes the richer selected context and describes target coordinates as `[longitude, latitude]`.

End-to-end tests should cover:

- Listing results show `New lead` on first search.
- Repeating the same listing URL shows `Seen before` after reload.
- A geocoded listing near a high-priority positive target displays a planning score and target/corridor planning signal.

## Out of Scope

- Background scheduled listing monitors.
- Server-side listing database.
- Scraping listing pages directly outside OpenAI hosted web search.
- Source-specific adapters for Craigslist, Zillow, Apartments.com, or broker sites.
- User accounts or cross-device sync.
- A full saved-leads management screen.
- Assistant proposals that mutate listing leads.
