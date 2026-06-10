# SF Apartment Search Map Design

## Summary

Build a public, anonymous, local-first apartment-search map for San Francisco. The app combines editable neighborhood/corridor geometry, AI-assisted map proposals, and sourced current-listing research. The first version uses Next.js App Router, TypeScript, Leaflet, OpenAI Responses API, and Google Geocoding.

The OpenAI key is user-provided. It is stored in `sessionStorage` by default, with an explicit "remember on this device" option that stores it in `localStorage`. The app never stores OpenAI keys server-side. Google Geocoding uses a server-owned `GOOGLE_MAPS_API_KEY` with route-level caps and SF-bound validation.

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

- Do not build accounts or a shared database in v1.
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
  - Returns structured listing candidates, source summary, and caveats.

- `POST /api/geocode/listing`
  - Uses server-owned `GOOGLE_MAPS_API_KEY`.
  - Accepts normalized listing address/intersection candidates produced by listing search.
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

type ListingCandidate = {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  neighborhoodGuess: string;
  priceMonthly: number | null;
  beds: "studio" | "1br" | "unknown";
  shortTermSignal: boolean;
  furnishedSignal: boolean;
  fitScore: 1 | 2 | 3 | 4 | 5;
  caveats: string[];
};

type MapPatchProposal = {
  summary: string;
  operations: Array<
    | { type: "addTarget"; target: TargetPoint }
    | { type: "addCorridor"; corridor: TargetCorridor }
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
- Use structured outputs for route responses.
- Use low reasoning effort for normal map edits.
- Use medium reasoning effort for listing searches and comparison/prioritization tasks.
- Use hosted `web_search` for explicit current-listing requests.
- Use `tool_choice: "required"` when the user asks for current listings.

The response shape includes:

- short human-readable explanation
- structured intent
- optional `MapPatchProposal`
- optional listing search request
- confidence
- caveats

## Listing Search

Listing search returns source-linked advisory candidates. It does not claim availability beyond what the source page indicates.

Candidate fields:

- title
- URL
- source domain
- neighborhood guess
- monthly price
- beds
- short-term signal
- furnished signal
- fit score
- why it fits
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

Route guardrails:

- Do not log OpenAI keys.
- Do not persist OpenAI keys server-side.
- Require a user-provided OpenAI key for real AI/listing calls.
- Return structured errors for missing keys or missing Google config.
- Limit listing and geocoding work per request.

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

Unit tests:

- Runtime schema validation for map zones, corridors, target points, listing candidates, and proposals.
- Valid `addTarget` applies.
- Invalid coordinates reject.
- Unknown zone ID rejects.
- `replaceZoneGeometry` outside SF rejects.
- Google geocoding outside-SF response rejects.

Mocked route tests:

- Map edit request returns a proposal.
- Prioritization request updates scores or priorities.
- Listing search request returns sourced candidates.
- Empty/noisy web-search result returns clear caveats.
- Missing OpenAI key returns disabled/error state.
- Missing Google key returns listing results without pins plus a config caveat.

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
- OSM tile attribution and usage-policy note
- no direct listing-site scraping policy

## Open Questions Deferred

- Whether to add user accounts later.
- Whether to add durable server-side rate limiting later.
- Whether to replace OSM-compatible tiles with a paid tile provider later.
- Whether to add a DataSF safety-context panel later.
- Whether to add a shared database for map versions later.
