# Planning Chat Architecture Design

## Goal

Replace the current assistant panel, proposal dialog, and listing-results surface with a unified planning chat. The chat should let a user ask for listings, pins, corridors, and edits in natural language, then review and execute explicit action cards.

The product should no longer feel like a form plus side effects. It should feel like a planning conversation where the app keeps track of context, explains what it found, and presents safe actions the user can accept or dismiss.

## Current State

The app has separate assistant paths:

- `components/apartment-map/assistant-panel.tsx` routes listing-like prompts by keyword and sends map edits to `/api/ai/map-assistant`.
- `/api/ai/map-assistant` can use OpenAI hosted `web_search`, geocode researched map candidates, and return reviewable `MapPatchProposal` records.
- `/api/ai/listing-search` searches current web results for listing candidates and returns geocode authorization.
- `ProposalReviewDialog` applies accepted map proposals through `/api/map/apply-proposal`.
- `ListingResults` renders listing candidates and the local listing ledger stores seen/saved listing data.
- Browser storage holds map state, geocode cache, OpenAI key, geocode session id, and listing ledger. There is no server database or account model today.

This works functionally, but the UX is split across a form, a modal, a listing section, selected-entity editors, and map popups. The assistant also has shallow context because follow-up state is local and narrow.

## Chosen Direction

Use a unified planning chat as the product boundary.

V1 should implement the chat UX and action-card contract without requiring autonomous multi-agent execution. The backend should be designed so it can later use the OpenAI Agents SDK, sessions, tracing, handoffs, and background workflows behind the same `/api/ai/planning-chat` endpoint.

This gives the product a clean current UX while avoiding a local-only architecture. Durable server-side state is acceptable and should become the canonical store for chat threads, action state, extracted preferences, listing lifecycle, and eventually map snapshots.

## Design Principles

- One conversation surface for planning work.
- Every mutation requires an explicit user action click in v1.
- AI proposes, deterministic code validates and applies.
- Chat action cards replace the proposal dialog and listing results section.
- Selected map entity editors stay available for precise manual edits.
- Store product state durably server-side, but never store the user's OpenAI key.
- Keep the first implementation request/response. Streaming can be added later without changing the message/action model.
- Preserve `MapPatchProposal` and `/api/map/apply-proposal` as the map mutation contract.

## UX Contract

The sidebar should center on a `PlanningChatPanel`.

The panel includes:

- chat timeline
- compact current-context card when relevant
- one composer
- request/response progress state
- action cards inside assistant messages

Remove the manual budget, beds, timing, short-term, and furnished form controls. The composer placeholder should teach by example:

- `Add pins for all Solidcore locations in SF`
- `Find studio or 1BR listings under $3k near my high-priority pins`
- `Create a corridor for the 1 California bus`
- `Make this selected pin a negative anchor for noise`

The assistant should ask follow-up questions when required information is missing. It should not require suggested replies in v1. Users answer in free text.

## Chat Parts

One assistant message can contain multiple typed parts:

```ts
type PlanningChatPart =
  | { type: "text"; text: string }
  | { type: "contextSummary"; context: PlanningContextSummary }
  | { type: "followUpQuestion"; question: string; missingInformation: string[] }
  | { type: "mapProposal"; actionId: string; proposal: MapPatchProposal; researchSummary: ResearchSummary | null }
  | { type: "listingResults"; actionId: string; resultSetId: string; listingIds: string[]; sourceSummary: string; caveats: string[] }
  | { type: "targetEditProposal"; actionId: string; proposal: MapPatchProposal }
  | { type: "error"; message: string };
```

The exact implementation can adapt to AI SDK `UIMessage.parts`, but the domain should own app-specific part schemas so the UI is testable without provider coupling.

## Action Model

Each actionable part has stable action state:

```ts
type PlanningActionStatus = "pending" | "applied" | "dismissed" | "failed";

type PlanningActionRecord = {
  id: string;
  threadId: string;
  messageId: string;
  partIndex: number;
  kind: "mapProposal" | "listingSave" | "listingDismiss" | "targetEdit";
  status: PlanningActionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
};
```

Map proposal cards should support:

- `Apply all`
- per-item remove before applying
- `Dismiss`

Applying a subset creates a filtered `MapPatchProposal` and sends it through `/api/map/apply-proposal`.

Listing result cards should support per-listing:

- `Save`
- `Dismiss`

The listing ledger remains the source of truth for saved, dismissed, seen, and latest candidate data. Chat cards are the review/action surface, not a second listing database.

## Durable State

Introduce server-side durable state. V1 can keep browser storage as a cache and migration fallback, but the product should treat the server store as canonical once available.

Suggested durable records:

- `PlanningThread`
  - `id`
  - `clientInstallationId`
  - `createdAt`
  - `updatedAt`
  - `title`
  - `summary`
- `PlanningMessage`
  - `id`
  - `threadId`
  - `role`
  - `parts`
  - `createdAt`
- `PlanningActionRecord`
  - action state and errors
- `PlanningPreferenceMemory`
  - extracted budget, beds, timing, furnished, short-term, target areas, avoid areas, commute anchors, and source strictness
- `ListingLead`
  - the existing ledger shape, moved server-side over time
- `MapSnapshot`
  - optional later, for cross-device and recovery

Anonymous v1 identity should use an opaque browser-generated installation id stored locally and sent with requests. This is not an account and should not be treated as authentication. Later, accounts can attach the same thread and ledger records to a user id.

## OpenAI Key Handling

The app should continue BYO OpenAI key behavior unless a separate product decision changes it.

- The browser sends the key as a bearer token per AI request.
- The server forwards it to OpenAI with `store: false`.
- The server never persists, logs, echoes, or traces the key.
- Durable chat state stores product data and model outputs, not OpenAI credentials.

If server-owned OpenAI keys are introduced later, they should be a separate spec because pricing, abuse controls, account identity, and quota enforcement change materially.

## Planning Chat Endpoint

Add `POST /api/ai/planning-chat`.

Request:

```ts
type PlanningChatRequest = {
  threadId: string | null;
  clientInstallationId: string;
  message: string;
  mapState: MapState;
  selectedEntity: SelectedMapEntity;
  visibleContext: PlanningContextSummary | null;
};
```

Response:

```ts
type PlanningChatResponse = {
  thread: PlanningThread;
  userMessage: PlanningMessage;
  assistantMessage: PlanningMessage;
  contextSummary: PlanningContextSummary;
  actionRecords: PlanningActionRecord[];
};
```

The endpoint should validate request size, request shape, chat part shape, model output, and all proposed actions with Zod and strict OpenAI JSON schemas.

Old routes can be removed after feature parity:

- `/api/ai/map-assistant`
- `/api/ai/listing-search`

Before removal, their core logic should be extracted into helpers that the planning-chat route can call. This avoids duplicating researched map validation, listing search sanitization, geocode authorization, and scoring.

## Context Management

The route should build context from four sources:

1. current map state
2. selected map entity
3. durable preference memory
4. recent chat transcript and action state

The model should receive a compact context object, not an unbounded full transcript. The context builder should:

- include recent user and assistant text turns
- include pending actions and their statuses
- include visible current preferences
- include selected target/corridor/zone details
- include relevant map entities and listing leads
- cap total serialized context size
- prefer summaries over raw old messages

No embeddings are required for v1. Deterministic summaries and structured state should be enough. Add embeddings only if retrieval over long histories becomes a concrete problem.

## Visible Context

The chat should show a compact "Current context" part when relevant:

- budget
- beds
- timing
- furnished or short-term preferences
- positive anchors
- avoid anchors
- selected zones
- source strictness or confidence needs

Users correct context through chat, not through form fields. Example: "Actually max budget is 3200" should update preference memory and show the corrected compact context in the next assistant response.

## Server Execution Strategy

V1 should use structured request/response calls through OpenAI Responses API:

- hosted `web_search` for current real-world research
- strict structured outputs for chat parts and proposed actions
- `store: false`
- deterministic server enrichment, geocoding, dedupe, and bounds checks

The endpoint should return a complete assistant message after the request finishes. It can show progress text in the client while pending, such as "researching locations" or "checking listing sources".

## Long-Term Agent Direction

The stable product boundary is `/api/ai/planning-chat` plus typed chat parts and action records. Internally, the route can later move to an agent runner without changing the UI contract.

Future agent-oriented pieces:

- triage agent for classifying user intent
- listing research agent
- map research agent for pins and corridors
- preference extraction agent
- source verification tools
- geocoding tools
- proposal-building tools
- handoffs between specialist agents
- tracing for model calls, tool calls, validations, and failures
- durable sessions or custom session memory backed by the app database
- human-in-the-loop approvals mapped to action cards

Do not start v1 with autonomous multi-agent execution. The product does not yet need agent loops, handoffs, or background workflows for every chat turn. Introduce them when the chat contract is stable and there is evidence that single-turn structured workflows are limiting result quality.

## Privacy And Security

Durable state changes the product posture. The implementation must make that explicit.

- Store only planning data needed for the product.
- Do not store OpenAI keys.
- Redact secrets from errors before returning them to the client.
- Keep Google geocoding server-only and rate-limited.
- Keep AI-generated mutations reviewable and server-validated.
- Do not expose raw upstream error bodies to chat.
- Add a clear local control for clearing server-backed thread data once server persistence exists.
- If anonymous installation ids are used, treat them as bearer-like identifiers and avoid exposing them in logs.

## Data Migration

Initial implementation can load existing browser storage and create the first server thread:

- map state remains existing local storage in v1 unless map snapshots are implemented
- listing ledger can stay local until server ledger is added
- chat storage starts server-side, with a local cached copy for reload resilience
- reset local map clears local map data, local chat cache, and server thread/action state for the current installation id

When server ledger replaces local ledger, write a one-time migration from `sf-apt-hunt:listing-ledger:v1` into durable records.

## UI Layout

Sidebar order:

1. top controls: API key, reset, undo, layer toggles
2. selected entity editor when an entity is selected
3. planning chat timeline and composer

The chat timeline should be dense and operational, not a marketing-style bot page. Cards should be compact, source-linked, and easy to scan. The map remains the primary spatial surface.

## Testing

Unit tests:

- chat part schemas accept text, context, proposal, listing, and error parts
- action state transitions from pending to applied, dismissed, or failed
- context builder caps size and includes selected entity details
- preference memory updates from structured model output
- filtered map proposals preserve valid `MapPatchProposal` shape

Route tests:

- planning-chat request validates thread id, installation id, map state, selected entity, and message
- route sends OpenAI `store: false`
- route can return multiple action parts in one assistant message
- route normalizes strict OpenAI schema nulls before Zod validation
- route redacts upstream errors
- route rejects oversized requests before calling OpenAI

E2E tests:

- user asks for researched pins and sees a chat action card
- applying the card adds pins to the map
- user asks for listings and sees listing result cards
- saving and dismissing listings updates card state and ledger state
- chat persists after refresh
- reset clears chat, pending actions, and listing/map state for the current app reset flow

## Out Of Scope For V1

- autonomous background listing monitors
- multi-thread chat browser
- accounts and cross-device sync
- server-owned OpenAI keys
- streaming token-by-token assistant responses
- embeddings or vector search over chat history
- full agent runner with handoffs
- official transit geometry ingestion beyond existing researched corridor validation
- automatic map mutations without an action click

## Research Notes

- AI SDK v6 `useChat` provides managed chat state, status, error handling, `sendMessage`, transport configuration, and message `parts`.
- AI SDK tool usage supports tool parts that can represent user-interaction steps; this maps well to action cards even if v1 uses request/response.
- OpenAI Responses API supports hosted `web_search`, strict structured outputs, and conversation continuation with `previous_response_id`.
- Responses API server-managed state can be useful later, but `store: false` and app-owned durable state fit the current privacy posture better.
- OpenAI Agents SDK provides runners, sessions, handoffs, tracing, and human-in-the-loop patterns that are valuable for the long-term backend direction.

References:

- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
- https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/conversation-state
- https://openai.github.io/openai-agents-js/guides/running-agents/
- https://openai.github.io/openai-agents-js/guides/sessions/
- https://openai.github.io/openai-agents-js/guides/handoffs/
- https://openai.github.io/openai-agents-js/guides/tracing/
