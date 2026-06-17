# Researched Map Assistant Design

## Goal

Let the map assistant create reviewable pins and corridors from real-world research. A user should be able to ask for things like "all Orange Theory locations in SF" or "the corridor where the 1 California bus runs" and get a sourced map proposal instead of needing to manually find addresses or route geometry.

The assistant should remain conversational. Its goal is to gather enough relevant information to produce a high-confidence, reviewable map proposal. The app defines the contract and validation rules; it should not hard-code brand-specific, route-specific, or wizard-like question flows.

## Current State

The map assistant can already return `MapPatchProposal` records with `addTarget` and `addCorridor` operations. Those proposals are reviewed by the user and re-validated by `/api/map/apply-proposal` before the map changes.

The map assistant currently has no web search or geocoding step. It receives the current map state and can propose edits, but it cannot reliably discover real-world locations or route geometry.

Listing search already uses OpenAI hosted `web_search` and a protected Google geocoding path. Listing geocoding is nonce-bound when called from the browser, rate-limited, and rejects results outside San Francisco bounds.

## Design Principles

- AI proposes; the server disposes. The assistant can interpret intent and find sources, but deterministic code validates shape, bounds, caps, duplicates, and reviewability.
- Use generic research capabilities. Do not add source-specific logic for Orange Theory, Muni route 1, or any other one-off entity.
- Prefer official source geometry when available, but allow honest approximate corridors as editable planning objects.
- Keep the first version lean: no suggested replies, no scope enums, no research ledger, no full research-results browser, no automatic apply.
- Treat coordinates as `[longitude, latitude]` throughout domain state and proposal contracts.

## Conversation Contract

The map assistant response should support three outcomes:

```ts
type MapAssistantOutcome =
  | {
      kind: "needsMoreInfo";
      assistantMessage: string;
      missingInformation: string[];
    }
  | {
      kind: "proposal";
      assistantMessage: string;
      proposal: MapPatchProposal;
      researchSummary: ResearchSummary;
    }
  | {
      kind: "noAction";
      assistantMessage: string;
      caveats: string[];
    };
```

`assistantMessage` is the only required user-facing chat text. The LLM can phrase follow-up questions naturally. `missingInformation` is structured support for the app, tests, and debugging; it should not force a fixed UI flow.

Common missing information can include:

- what to find: brand, place type, transit route, amenity, corridor, or other entity
- where to search: SF, nearby SF, selected zones, near a target, along a corridor, or a custom area
- what object to create: pins, corridors, or both
- purpose and influence: positive anchor, negative avoid point, neutral reference, transit corridor, fitness corridor, safety concern
- strictness: official sources only or approximate acceptable
- scope limits: all matching results, top N, currently open/active only, confirmed addresses only
- route ambiguity: inbound, outbound, shared segment, branch, or full route

The first version should not include `suggestedReplies`. Freeform follow-up chat is enough.

## Research Flow

When the route decides a prompt needs outside knowledge, it calls OpenAI with hosted `web_search` and strict structured output. The model returns discovered map entities with source evidence and enough fields for deterministic enrichment.

The route then enriches and validates those candidates before returning a normal proposal:

1. The user sends a map-assistant message.
2. The server validates the request body and sends map context plus the user message to OpenAI.
3. OpenAI either asks for more information, returns no action, or returns researched target and corridor candidates.
4. The server geocodes target candidates and corridor waypoints where needed.
5. The server validates bounds, point counts, duplicate IDs, caps, and source metadata.
6. The server converts accepted candidates into `MapPatchProposal.operations`.
7. The client shows the existing proposal review dialog.
8. Applying the proposal continues through `/api/map/apply-proposal`.

The map assistant route should not trust model-supplied coordinates for pins. It may accept model-supplied route geometry only when the model identifies a credible geometry source and the geometry passes deterministic validation.

## Target Pin Research

For place-like requests, the model returns target candidates with:

- name
- address or geocode query
- source URL and source title
- purpose
- influence
- priority
- radius minutes
- confidence
- caveats

The server geocodes each candidate using a shared server-side geocoding helper. Browser nonce authorization is not needed because the map assistant route runs server-side, but the same production safety expectations still apply: Google key stays server-only, failures are redacted, results are bounds-checked, and production rate limiting must fail closed when Redis configuration is missing.

Successful geocodes become `addTarget` operations. Failed, duplicate, or out-of-bounds results are excluded from operations and summarized in `researchSummary`.

## Corridor Research

Corridor candidates need ordered geometry, not just one geocoded point. The model returns:

- corridor name
- source URL and source title
- intended tags
- priority
- notes and caveats
- geometry quality
- one of:
  - sourced LineString geometry
  - ordered stops or waypoints with coordinates or geocode queries
  - route text with major turns or endpoints

The server should build corridors using these source-quality tiers:

1. **Official geometry**
   Use GTFS shapes, agency GeoJSON, encoded polylines, or another source that provides route geometry.
2. **From stops or waypoints**
   Use ordered official stops or geocoded ordered waypoints to create a simplified LineString.
3. **Approximate from description**
   Use route text, endpoints, and major turns to create a simplified editable corridor.

Approximate corridors are allowed because this app uses corridors as planning objects, not navigation-grade directions. Low-confidence corridors must be clearly labeled in review and remain easy to edit after apply.

Every final corridor must satisfy the existing `TargetCorridor` contract: a `LineString` with 2 to the configured maximum number of points, valid `[lng, lat]` coordinates, accepted tags, notes, and priority.

## Bounds And Nearby Areas

Current proposal validation requires target and corridor coordinates to be inside San Francisco bounds. That is correct for "in SF" prompts.

Prompts like "in and nearby SF" or "near SF" should not be implemented by letting the LLM bypass validation. If nearby support is desired, the implementation should add an explicit allowed-map-area policy, such as:

- strict SF bounds for "in SF"
- SF plus configured buffer for "nearby SF"
- selected map area when the user references selected zones or targets

The first implementation may keep the existing SF-only bounds and return a caveat when nearby results are excluded. Expanding bounds can be a separate, explicit feature if needed.

## Review UI

The existing proposal review dialog remains the final gate. It should show enough research metadata for the user to trust or reject the proposal:

- source URL or citation for each proposed item
- confidence: `high`, `medium`, or `low`
- corridor geometry quality: `official`, `fromStops`, or `approximate`
- caveats
- excluded/duplicate result summary when useful

Do not add a full research-results browser in v1. The proposal review should stay focused on the map changes that would be applied.

## Data Contracts

The implementation must keep TypeScript types, Zod schemas, and raw OpenAI JSON schemas aligned.

Add a researched assistant response schema for `needsMoreInfo`, `proposal`, and `noAction`. The existing `MapPatchProposal` schema can remain the apply contract, but proposal review may need a companion `researchSummary` object that is shown in the UI and not persisted into map state.

The `MapPatchProposal` operations should remain the actual mutation language:

- researched pins become `addTarget`
- researched corridors become `addCorridor`
- later metadata edits can continue using existing update operations

Research metadata should not be required by `/api/map/apply-proposal`; apply should continue validating only the final map mutation contract.

## Error Handling

- If web search fails, return `noAction` with a safe assistant message.
- If geocoding is not configured, return a proposal only for candidates that already have trustworthy validated geometry; otherwise return `noAction` or `needsMoreInfo` with a configuration caveat.
- If some candidates fail geocoding or validation, return the valid operations plus caveats and excluded-result summary.
- If every candidate fails validation, return `noAction`.
- Never return raw upstream OpenAI or Google error bodies to the client.

## Testing

Route tests should cover:

- `needsMoreInfo` responses for underspecified researched map prompts.
- researched target candidates are geocoded and converted to `addTarget`.
- model-supplied target coordinates are ignored in favor of server geocoding.
- failed, duplicate, or out-of-bounds target results are excluded with caveats.
- official corridor geometry is converted to `addCorridor`.
- ordered waypoints can create a simplified corridor.
- approximate corridor output is labeled and validated.
- invalid or out-of-bounds corridor geometry is rejected.
- OpenAI structured-output schema stays strict for all new response shapes.
- Google failures and upstream errors are redacted.

Unit tests should cover:

- candidate-to-target conversion.
- candidate-to-corridor conversion for official, waypoint, and approximate tiers.
- point-count caps and bounds filtering.
- duplicate target and corridor ID handling.
- research summary generation.

E2E tests should cover:

- a prompt that asks for real-world pins and shows sourced target proposals for review.
- a prompt that asks for a bus route corridor and shows geometry quality in review.
- an underspecified researched prompt that produces a chat follow-up instead of a bad proposal.

## Out Of Scope

- Suggested reply buttons.
- Scope enums such as `sf_only` or `sf_and_nearby`.
- A saved research ledger or search history.
- Background monitoring for changed locations or routes.
- Automatic apply.
- Navigation-grade route directions.
- Brand-specific or route-specific adapters.
- A full research-results management screen.
