# SF Apartment Search Map Design

## Summary

Build a public, anonymous, local-first apartment-search map for San Francisco. The app combines editable neighborhood/corridor geometry, AI-assisted map proposals, and sourced current-listing research. The first version uses Next.js App Router, TypeScript, Leaflet, OpenAI Responses API, and Google Geocoding.

The OpenAI key is user-provided. It is stored in `sessionStorage` by default, with an explicit "remember on this device" option that stores it in `localStorage`. The app never stores OpenAI keys server-side. Google Geocoding uses a server-owned `GOOGLE_MAPS_API_KEY` with nonce-bound requests, durable serverless rate limits, route-level caps, and SF-bound validation.

## Goals

- Render practical apartment-search zones for selected San Francisco neighborhoods.
- Let users manually edit map geometry with immediate drag handles, undo, and reset.
- Let AI propose map edits, prioritization changes, caution notes, and listing searches.
- Require user review before applying AI-generated map changes.
- Search for current rental listings using OpenAI hosted web search and source-linked output.
- Geocode listing addresses with Google only after listing candidates are found.
- Keep user map edits and listing/geocode cache local to the browser.
- Document setup, environment variables, quota controls, and public deployment caveats.

## Non-Goals

- Do not build accounts or a shared app database in v1. A durable shared rate-limit store is still required for public serverless geocoding protection.
- Do not use a server-owned OpenAI key for public anonymous traffic.
- Do not scrape Zillow, Craigslist, Apartments.com, or listing sites directly.
- Do not add explicit crime datasets or numeric safety rankings in v1.
- Do not use Google Maps as the base map in v1.

## Architecture

The app is a single-page Next.js App Router application.

Client surfaces:

- Leaflet map with editable zones, corridors, points, caution zones, and listing pins.
- Right-side panel for filters, selected area details, API-key status, AI assistant, and listing results.
- Review modal for AI proposals.
- API-key modal for session/local device storage choice.

Server route handlers:

- `POST /api/ai/map-assistant`
  - Accepts the user's OpenAI key per request.
  - Accepts user message, current map state, selected zone IDs, active filters, and edit context.
  - Returns a structured assistant response with optional `MapPatchProposal`.

- `POST /api/ai/listing-search`
  - Accepts the user's OpenAI key per request.
  - Accepts selected neighborhoods/corridors, budget, beds, move timing, short-term/furnished preferences, and natural-language context.
  - Uses OpenAI hosted `web_search` for current listing research.
  - Returns structured listing candidates, source summary, citations, caveats, and a short-lived geocode nonce for candidates that may be geocoded.

- `POST /api/geocode/listing`
  - Uses server-owned `GOOGLE_MAPS_API_KEY`.
  - Accepts only normalized listing address/intersection candidates produced by a recent listing search.
  - Requires a signed, short-lived geocode nonce from `/api/ai/listing-search`.
  - Enforces durable per-IP and per-session quotas through a serverless-safe shared store.
  - Caps geocoding attempts per search.
  - Rejects results outside San Francisco bounds.
  - Returns coordinates with confidence and exact/approximate marker state.

- `POST /api/map/apply-proposal`
  - Validates a `MapPatchProposal`.
  - Does not persist shared state in v1.
  - Returns validated operations for client-side application.

## Data Model

Shared TypeScript modules define and validate:

```ts
type MapZone = {
  id: string;
  name: string;
  kind: "neighborhood" | "caution";
  geometry: GeoJSON.Polygon;
  fitnessScore: 1 | 2 | 3 | 4 | 5;
  affordabilityScore: 1 | 2 | 3 | 4 | 5;
  carFreeScore: 1 | 2 | 3 | 4 | 5;
  notes: string[];
};

type TargetCorridor = {
  id: string;
  name: string;
  geometry: GeoJSON.LineString;
  priority: "high" | "medium" | "low";
  tags: Array<"fitness" | "rent" | "transit" | "safety" | "short-term">;
  notes: string[];
};

type TargetPoint = {
  id: string;
  name: string;
  coordinates: [number, number];
  priority: "high" | "medium" | "low";
  notes: string[];
};

type SourceCitation = {
  url: string;
  title: string | null;
  sourceDomain: string;
};

type GeocodeAuthorization = {
  nonce: string;
  expiresAt: string;
  maxAttempts: number;
  allowedQueries: Array<{
    candidateId: string;
    geocodeQueryHash: string;
  }>;
};

type ListingCandidate = {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  neighborhoodGuess: string;
  locationText: string | null;
  geocodeQuery: string | null;
  locationConfidence: "none" | "low" | "medium" | "high";
  coordinates: [number, number] | null;
  geocodeStatus:
    | "not_attempted"
    | "geocoded_exact"
    | "geocoded_approximate"
    | "failed"
    | "outside_sf";
  markerPrecision: "none" | "exact" | "approximate";
  priceMonthly: number | null;
  beds: "studio" | "1br" | "unknown";
  shortTermSignal: boolean;
  furnishedSignal: boolean;
  fitScore: 1 | 2 | 3 | 4 | 5;
  whyItFits: string;
  citations: SourceCitation[];
  caveats: string[];
};

type ListingSearchResponse = {
  candidates: ListingCandidate[];
  sourceSummary: string;
  citations: SourceCitation[];
  caveats: string[];
  geocodeAuthorization: GeocodeAuthorization | null;
};

type MapPatchProposal = {
  summary: string;
  operations: Array<
    | { type: "addTarget"; target: TargetPoint }
    | { type: "addCorridor"; corridor: TargetCorridor }
    | {
        type: "updateCorridorPriority";
        corridorId: string;
        priority: "high" | "medium" | "low";
        reason: string;
      }
    | {
        type: "updateTargetPriority";
        targetId: string;
        priority: "high" | "medium" | "low";
        reason: string;
      }
    | {
        type: "updateZoneScores";
        zoneId: string;
        fitnessScore?: number;
        affordabilityScore?: number;
        carFreeScore?: number;
      }
    | {
        type: "replaceZoneGeometry";
        zoneId: string;
        geometry: GeoJSON.Polygon;
        reason: string;
      }
    | { type: "addNote"; entityId: string; note: string }
  >;
  confidence: "low" | "medium" | "high";
  requiresUserReview: true;
};
```

Coordinate convention:

- GeoJSON geometry coordinates use `[longitude, latitude]`.
- `TargetPoint.coordinates` and `ListingCandidate.coordinates` also use `[longitude, latitude]`.
- The UI may display coordinates as latitude/longitude, but storage and validation use longitude/latitude.

Seed data ships locally for:

- Marina/Cow Hollow
- Lower Pac Heights
- Mission Dolores/Valencia
- Lower Haight/Duboce/Hayes
- Nob Hill/Polk Gulch
- Panhandle/NOPA
- Van Ness/Lower Russian Hill

The UI displays this note persistently:

> Boundaries are approximate apartment-search zones, not official boundaries.

## Map And Editing

The map uses Leaflet with OSM-compatible raster tiles.

Requirements:

- Center on San Francisco.
- Use a configurable tile URL.
- Show required attribution.
- Do not prefetch tiles or implement offline tile storage.
- Render zones, corridors, target points, caution zones, and listing pins as separate toggleable layers.

Manual edit mode:

- Users can drag polygon vertices for zones and caution zones.
- Users can drag line vertices for corridors.
- Users can move target points.
- Manual edits apply immediately to client state.
- Manual edits autosave to `localStorage`.
- The app supports undo last edit, reset selected shape, reset all local changes, and copy/export local map JSON.

AI map edits:

- The model never mutates map state directly.
- The model returns a `MapPatchProposal`.
- The UI opens a review modal with operation list and before/after geometry preview where applicable.
- The user can apply changes, reject changes, or copy proposal JSON.

## AI Assistant

The assistant uses one natural-language input for both map work and listing search. Structured controls sit beside it for:

- selected neighborhoods/corridors
- budget
- beds
- move timing
- short-term preference
- furnished preference

The assistant should infer structured filters from natural language, then let users correct them before or after a search.

OpenAI usage:

- Use the Responses API.
- Default model is `gpt-5.5`, configurable by code constant or environment setting if access differs.
- Set `store: false` for Responses calls where the API supports it.
- Use structured outputs for route responses.
- Use low reasoning effort for normal map edits.
- Use medium reasoning effort for listing searches and comparison/prioritization tasks.
- Use hosted `web_search` for explicit current-listing requests.
- Use `tool_choice: "required"` when the user asks for current listings.
- Preserve and display clickable web-search citations, including citations for source summaries and listing-specific claims.

The response shape includes:

- short human-readable explanation
- structured intent
- optional `MapPatchProposal`
- optional listing search request
- confidence
- caveats

## Listing Search

Listing search returns source-linked advisory candidates. It does not claim availability beyond what the source page indicates.

The route response uses the `ListingSearchResponse` contract. `geocodeAuthorization` is present only when one or more returned candidates include a geocodeable query.

Candidate fields:

- title
- URL
- source domain
- neighborhood guess
- location text
- normalized geocode query
- location confidence
- coordinates and geocode status when available
- marker precision
- monthly price
- beds
- short-term signal
- furnished signal
- fit score
- why it fits
- citations
- caveats

The route should include query constraints such as:

- San Francisco
- selected neighborhood/corridor names
- studio or 1 bedroom
- budget ceiling
- furnished or short-term when requested

Listing result caveats:

- Users must click through to verify availability and terms.
- Listings may be stale, duplicated, mispriced, or syndicated.
- No direct client-side scraping is allowed.

## Geocoding

Google Geocoding is server-owned and route-scoped.

Rules:

- Use `GOOGLE_MAPS_API_KEY` only on the server.
- Only geocode likely addresses or intersections from listing candidates.
- Do not expose a general-purpose geocoding proxy.
- Require a signed, short-lived nonce minted by `/api/ai/listing-search`.
- Bind each nonce to the listing-search request, candidate IDs, canonical geocode-query hashes, and a capped number of geocode attempts.
- Canonicalize each allowed query before signing by trimming whitespace, lowercasing, collapsing internal whitespace, and appending `san francisco ca` when the model omitted the city.
- The nonce payload must sign the allowed `candidateId` plus canonical `geocodeQuery` hash pairs, or sign/encrypt the allowed candidate geocode payloads directly.
- `/api/geocode/listing` must recompute the canonical query hash from the client request and reject any candidate/query pair not present in the nonce.
- Enforce durable per-IP and per-session quotas in a serverless-safe shared store such as a Redis-compatible Vercel Marketplace integration.
- Fail closed when the rate-limit store is unavailable in production.
- Do not expose the Google key to the browser.
- Cap geocode attempts per listing search.
- Cache successful and failed geocode results in browser storage by normalized address.
- Reject coordinates outside SF bounds.
- Mark listing pins as approximate unless confidence is high.
- Document Google Cloud API restrictions, quotas, and billing requirements.

## API-Key UX

OpenAI key handling:

- No server-owned OpenAI key for public anonymous traffic.
- If no user key exists, AI/listing features show a disabled/demo state.
- Users can enter a key in the UI.
- The default storage is `sessionStorage`.
- An explicit "remember on this device" toggle stores the key in `localStorage`.
- The key is sent to route handlers per request.
- Route handlers must not log, store, or echo the key.
- Route handlers must redact OpenAI keys from request logs, error logs, traces, and telemetry.
- Route handlers must not include raw request bodies in thrown errors or structured error responses.
- Responses API calls use `store: false` where supported.

## Environment Configuration

Required for public deployment:

- `GOOGLE_MAPS_API_KEY`: server-only Google Geocoding key restricted to the Geocoding API.
- Rate-limit store credentials for a Redis-compatible serverless store, such as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- `GEOCODE_NONCE_SECRET`: server-only secret for signing short-lived geocoding nonces.

Optional:

- `OPENAI_MODEL`: model override when the default `gpt-5.5` is unavailable for a user.
- `NEXT_PUBLIC_TILE_URL`: OSM-compatible tile URL override.
- `NEXT_PUBLIC_TILE_ATTRIBUTION`: attribution text for the configured tile source.

Production behavior:

- Real listing geocoding is disabled when Google or rate-limit configuration is missing.
- Missing Google config can still return listing cards without pins.
- Missing rate-limit config must make geocoding fail closed in production.

## Safety Context

V1 does not integrate explicit crime/safety datasets.

Safety behavior:

- Treat safety as advisory language, not an objective score.
- Let users add caution notes and caution zones.
- Let AI propose caution notes, subject to user review.
- Comparisons should include "verify with current local sources" caveats.

A future version may add a DataSF safety-context panel with strong caveats and no simple safe/unsafe ranking.

## Validation And Guardrails

Runtime validation rejects:

- unknown proposal operation types
- unknown zone/entity IDs
- invalid coordinate order
- invalid polygon/line geometry
- coordinates outside SF bounds
- invalid score ranges
- invalid priority values
- oversized user messages
- oversized map state payloads
- listing results without source URLs
- listing results without citations for listing-specific claims
- listing results without `whyItFits`
- listing coordinates outside SF bounds
- geocoding requests without a valid recent nonce
- geocoding requests where the candidate ID and canonical geocode query hash do not match the signed nonce payload

Route guardrails:

- Do not log OpenAI keys.
- Do not persist OpenAI keys server-side.
- Require a user-provided OpenAI key for real AI/listing calls.
- Return structured errors for missing keys or missing Google config.
- Limit listing and geocoding work per request.
- Enforce durable per-IP and per-session geocoding quotas before public deployment.
- Fail closed for geocoding when quota checks cannot run.
- Redact secret-bearing fields from telemetry and error reporting.

## UI Direction

The interface should feel like a compact decision cockpit for apartment hunting rather than a marketing page.

Design constraints:

- First screen is the map app, not a landing page.
- Main map takes the left/main area.
- Right panel contains filters, selected details, assistant, API-key status, and results.
- Use dense but readable controls.
- Keep cards only for repeated listing results and modal content.
- Use Phosphor icons because the repo is configured for them.
- Preserve the existing Tailwind v4 and shadcn/base-lyra setup.
- Keep text compact enough to fit mobile and desktop panel widths.

## Testing

Tooling:

- Use Vitest for unit and route tests.
- Use Playwright for browser tests.
- Mock OpenAI and Google HTTP calls in tests.
- Stabilize Leaflet browser tests by using a fixed viewport, deterministic seed data, and intercepted tile requests or a local/static tile stub.

Unit tests:

- Runtime schema validation for map zones, corridors, target points, listing candidates, listing search responses, and proposals.
- Valid `addTarget` applies.
- Invalid coordinates reject.
- Unknown zone ID rejects.
- `replaceZoneGeometry` outside SF rejects.
- `updateCorridorPriority` and `updateTargetPriority` validate IDs and priority values.
- Google geocoding outside-SF response rejects.
- Geocoding nonce validation rejects missing, expired, mismatched, and over-cap tokens.
- Geocoding nonce validation rejects tampered geocode queries for otherwise-valid candidate IDs.
- OpenAI-key redaction covers request, response, and error paths.

Mocked route tests:

- Map edit request returns a proposal.
- Prioritization request updates scores or priorities.
- Listing search request returns sourced candidates.
- Empty/noisy web-search result returns clear caveats.
- Missing OpenAI key returns disabled/error state.
- Missing Google key returns listing results without pins plus a config caveat.
- Web-search citations are preserved and rendered as clickable source links.
- Rate-limit-store outage makes geocoding fail closed in production mode.

Browser tests:

- Map renders all base zones.
- Layer toggles work.
- Manual edit mode changes geometry.
- Undo/reset controls work.
- AI proposal appears but does not apply until confirmation.
- Applied proposal changes local map state.
- Listing results render with source links and caveats.
- Listing pins render only when geocoding succeeds.

Manual acceptance:

- "Find studio/1BR under $3k near Lower Pac Heights" returns sourced candidates or clearly says none found.
- "Make Valencia target corridor more important" produces a reviewable priority update.
- "Add a caution note near 16th & Mission" creates a pending proposal, not an automatic edit.
- Refresh preserves local manual edits.
- Clearing local data returns the seed map.

## Documentation

Update README with:

- local development commands
- required and optional env vars
- `GOOGLE_MAPS_API_KEY` setup
- OpenAI BYO-key behavior
- public deployment caveats
- Google Cloud quota/API restriction recommendations
- serverless rate-limit store setup for geocoding protection
- OSM tile attribution and usage-policy note
- no direct listing-site scraping policy

## Open Questions Deferred

- Whether to add user accounts later.
- Whether to add broader durable rate limiting for non-geocoding routes later.
- Whether to replace OSM-compatible tiles with a paid tile provider later.
- Whether to add a DataSF safety-context panel later.
- Whether to add a shared database for map versions later.
