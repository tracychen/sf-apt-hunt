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
- Preserve `MapPatchProposal` and the existing apply-proposal validation logic as the map mutation contract, but route chat actions through the durable planning action endpoint.

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
  | { type: "listingResults"; resultSetId: string; listings: PlanningListingCard[]; sourceSummary: string; caveats: string[]; geocodeAuthorization: GeocodeAuthorization | null }
  | { type: "targetEditProposal"; actionId: string; proposal: MapPatchProposal }
  | { type: "error"; message: string };

type PlanningListingCard = {
  lead: ListingLead;
  display: ListingDisplayCandidate;
  saveActionId: string;
  dismissActionId: string;
};
```

The exact implementation can adapt to AI SDK `UIMessage.parts`, but the domain should own app-specific part schemas so the UI is testable without provider coupling.

Listing result parts must be renderable without an extra fetch. `listingIds` alone are not enough for v1 because the route response should let the chat immediately show title, price, location, source, planning score, citations, caveats, and per-listing action buttons. The part also carries `geocodeAuthorization` so the client can reuse the existing nonce-bound listing geocoding flow for candidates that need markers. A later saved-leads browser can add fetch-by-id APIs, but the chat turn response should hydrate the result cards it creates.

## Action Model

Each actionable part has stable action state:

```ts
type PlanningActionStatus = "pending" | "applied" | "dismissed" | "failed";
type PlanningActionFailureKind = "retryable" | "permanent";

type PlanningActionTarget =
  | {
      kind: "mapProposal";
      messageId: string;
      partIndex: number;
      proposalHash: string;
      allowedOperationIndexes: number[];
      mapRevision: string;
    }
  | {
      kind: "mapProposalItem";
      messageId: string;
      partIndex: number;
      proposalHash: string;
      operationIndex: number;
      mapRevision: string;
    }
  | {
      kind: "listingLead";
      resultSetId: string;
      canonicalUrl: string;
      listingSnapshotHash: string;
      listingLedgerRevision: string;
    }
  | {
      kind: "targetEdit";
      messageId: string;
      partIndex: number;
      proposalHash: string;
      allowedOperationIndexes: number[];
      mapRevision: string;
    };

type PlanningActionRecord = {
  id: string;
  threadId: string;
  messageId: string;
  partIndex: number;
  kind: "mapProposal" | "mapProposalItem" | "listingSave" | "listingDismiss" | "targetEdit";
  target: PlanningActionTarget;
  status: PlanningActionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  failureKind?: PlanningActionFailureKind;
};

type PlanningActionExecutionRecord = {
  id: string;
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: "succeeded" | "failed";
  createdAt: string;
  error?: string;
};
```

Map proposal cards should support:

- `Apply all`
- per-item remove before applying
- `Dismiss`

Applying a subset creates a filtered `MapPatchProposal` inside the planning action endpoint, then validates it through the same apply-proposal path used by the existing route.

Listing result cards should support per-listing:

- `Save`
- `Dismiss`

The listing ledger remains the source of truth for saved, dismissed, seen, and latest candidate data. Chat cards are the review/action surface, not a second listing database.

Action records must bind to the thing they can mutate. The client may choose a subset of allowed map operations, but it must not provide a replacement proposal body, listing URL, or listing payload at execution time. The server derives those from the stored assistant message part and `PlanningActionRecord.target`, then verifies hashes before applying any mutation.

`proposalHash` and `listingSnapshotHash` should be computed from canonical serialized server-validated payloads, not from raw model text or client display JSON.

Action execution needs a durable API separate from chat generation:

```ts
type ExecutePlanningActionRequest = {
  threadId: string;
  actionId: string;
  idempotencyKey: string;
  payload:
    | { kind: "mapProposal"; operationIndexes: number[]; expectedMapRevision: string }
    | { kind: "listingSave"; expectedListingLedgerRevision: string }
    | { kind: "listingDismiss"; expectedListingLedgerRevision: string }
    | { kind: "targetEdit"; operationIndexes: number[]; expectedMapRevision: string }
    | { kind: "dismiss" };
};

type ExecutePlanningActionResponse = {
  action: PlanningActionRecord;
  execution: PlanningActionExecutionRecord;
  mapSnapshot?: MapSnapshot;
  mapState?: MapState;
  listingLead?: ListingLead;
  listingLedgerRevision?: string;
  messagePatch?: PlanningMessage;
};
```

Add `POST /api/planning/actions/execute` or an equivalent route. It must:

- verify thread/action ownership before reading or mutating durable state
- load the stored action target and reject client attempts to execute a different proposal, listing, or action kind
- check the idempotency key and payload hash before terminal-state rejection
- return the stored execution result for repeated requests with the same `idempotencyKey` and payload hash, even when the action is already terminal
- reject reused idempotency keys with different payloads
- reject unknown, already-terminal, permanently failed, or incompatible actions after replay handling
- create a `PlanningActionExecutionRecord` for each first-seen idempotency key
- apply map proposals against the server-owned `MapSnapshot` through the same validation path as `/api/map/apply-proposal`
- require `expectedMapRevision` and `expectedListingLedgerRevision` to match the durable state revision before mutation
- support per-item subset apply only when indexes are a subset of the persisted allowed operation indexes
- update listing lead status through the listing ledger source of truth
- record failed action attempts with redacted errors
- transition actions from `pending -> applied`, `pending -> dismissed`, or `pending -> failed`
- allow retrying `failed` actions with a new idempotency key only when `failureKind` is `retryable`; permanent failures reject new execution attempts

`/api/map/apply-proposal` can remain as a low-level stateless validation route or helper, but chat cards should call the planning action endpoint so durable action state stays consistent with map/listing mutations.

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
  - the existing ledger shape, moved server-side
- `MapSnapshot`
  - canonical map state, current revision, and update metadata

For planning-chat v1, the server store is the canonical owner of chat threads, action records, listing lifecycle, preference memory, and the active map snapshot. Browser storage remains useful as a bootstrap source, optimistic cache, and recovery fallback, but it should not be the source of truth for actions created by the planning chat.

`MapSnapshot` should include:

- `id`
- `threadId` or `clientInstallationId`
- `mapState`
- `revision`
- `createdAt`
- `updatedAt`

The revision can be an opaque string or monotonically increasing number, but every chat turn and action execution that depends on map state should include the revision it observed. Mutations must fail with a stale-state error when the expected revision does not match the current durable revision.

The server listing ledger should also expose an opaque `listingLedgerRevision`. Listing save/dismiss actions use that revision to avoid overwriting newer lifecycle changes.

Listing lead status should expand from the current local `"new" | "seen"` shape to:

```ts
type ListingLeadStatus = "new" | "seen" | "saved" | "dismissed";
```

Status behavior:

- a first-time result is stored as `new`
- a reappearing `new` or `seen` lead updates `latestCandidate`, increments `seenCount`, sets `lastSeenAt`, and becomes `seen`
- a reappearing `saved` lead keeps `saved` status while updating latest candidate and seen metadata
- a reappearing `dismissed` lead keeps `dismissed` status, updates seen metadata, and is omitted from primary result cards by default
- `Save` transitions `new`, `seen`, or `dismissed` to `saved`
- `Dismiss` transitions `new` or `seen` to `dismissed`
- saved leads should not be dismissed by an incidental card action without explicit UI wording that the user is unsaving/dismissing a saved lead

## Anonymous Ownership Model

Anonymous v1 identity is bearer-style access, even if it is not a user account.

The browser should generate and store two values:

- `clientInstallationId`: opaque public identifier used for lookup and partitioning.
- `clientInstallationSecret`: high-entropy secret used to prove ownership.

The server must store only a hash of the installation secret, such as SHA-256 or HMAC-SHA-256 with a server secret. It should never log or return the raw secret. Every durable-state request that reads, creates, mutates, resets, or deletes thread, action, preference, listing, or map-snapshot records must provide the installation id and prove possession of the matching secret.

Ownership checks:

- `PlanningThread.clientInstallationId` must match the request installation id.
- The stored installation secret hash must match the request secret.
- `PlanningMessage`, `PlanningActionRecord`, preference memory, listing leads, and map snapshots are reachable only through an owned thread or owned installation.
- Reset/delete endpoints require the same ownership check as normal reads and writes.
- Action execution must verify that the action belongs to the owned thread before applying map or listing mutations.

Operational behavior:

- If the secret is lost, anonymous server-side data is unrecoverable until account linking exists.
- If local storage is copied, the copied browser can access the same anonymous planning data. The UI should describe this as local-device identity, not as secure multi-user authentication.
- If accounts are introduced later, a migration can attach anonymous records to an authenticated user and rotate away from installation-secret-only access.
- Installation ids and secret hashes should be treated as sensitive in logs because they gate access to durable planning data.

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
  clientInstallationSecret: string;
  message: string;
  mapState: MapState;
  mapRevision: string | null;
  listingLedgerRevision: string | null;
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
  mapSnapshot: MapSnapshot;
  listingLedgerRevision: string;
};
```

The endpoint should validate request size, request shape, chat part shape, model output, and all proposed actions with Zod and strict OpenAI JSON schemas.

The request type shows `clientInstallationSecret` for contract clarity. The implementation should prefer a dedicated header, such as `x-sf-apt-installation-secret`, so the secret is not accidentally serialized into persisted chat messages or model context.

`mapState` is required for initial migration/bootstrap and for stale-client diagnostics. Once a durable `MapSnapshot` exists, the server uses the stored snapshot as canonical and treats client `mapState` as non-authoritative. If the client sends a `mapRevision` that does not match the durable snapshot, the route should either return a stale-state response with the current snapshot or ask the client to refresh before creating actions that depend on the map.

V1 should use manual request/response state management or a custom AI SDK transport that accepts and returns this JSON contract. It should not pretend to use the standard AI SDK UI message stream unless the route actually returns `UIMessage` stream semantics. If the implementation adopts AI SDK `useChat`, it must either:

- return a UIMessage-compatible stream using `toUIMessageStreamResponse()` after the full server computation finishes, or
- use custom transport/manual state and map `PlanningChatResponse` into local chat messages on the client.

The simpler v1 path is manual state plus app-owned `PlanningMessage.parts`. Streaming can be added later by adapting the same parts to AI SDK UI message streams.

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

V1 should not depend on OpenAI-stored conversation chains. Do not use `previous_response_id` as the source of chat memory while the app's privacy posture is `store: false`. Each turn should send app-built context from durable thread state, preference memory, selected map state, and recent summarized messages. OpenAI server-managed state can be reconsidered in a later spec if the product intentionally changes its storage and privacy posture.

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
- Treat anonymous installation secrets, ids, and hashes as bearer-like access material and avoid exposing them in logs.

## Data Migration

Initial implementation can load existing browser storage and create the first server thread:

- upload the current local map state into the first durable `MapSnapshot`
- migrate the local listing ledger into server `ListingLead` records
- store chat server-side, with a local cached copy for reload resilience
- keep local map and listing storage as cache/bootstrap data only after server migration succeeds
- reset local map clears local map data, local chat cache, durable map snapshot, server listing ledger, and server thread/action state for the current installation id

Migration should be idempotent. The client sends its current local map state and local listing ledger during first planning-thread creation or explicit migration. The server writes them once per installation/thread, returns durable revisions, and subsequent planning-chat turns use durable revisions rather than treating browser storage as canonical.

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
- idempotent action execution returns the prior result for the same key and payload
- idempotency-key reuse with a different payload is rejected
- idempotency replay is checked before terminal-state rejection
- retryable failed actions can be retried with a new idempotency key
- permanently failed actions reject new execution attempts
- context builder caps size and includes selected entity details
- preference memory updates from structured model output
- filtered map proposals preserve valid `MapPatchProposal` shape
- listing result parts include hydrated display data and per-listing action ids
- listing result parts include geocode authorization when candidates need client geocoding
- action records bind map proposals and listing actions to stored target refs and payload hashes
- listing lead status transitions cover new, seen, saved, dismissed, and reappearing leads
- installation secret hashing and ownership checks reject wrong installation secrets

Route tests:

- planning-chat request validates thread id, installation id, map state, selected entity, and message
- planning-chat rejects requests with a missing or mismatched installation secret
- route sends OpenAI `store: false`
- route can return multiple action parts in one assistant message
- route normalizes strict OpenAI schema nulls before Zod validation
- route redacts upstream errors
- route rejects oversized requests before calling OpenAI
- action execution applies a subset of map proposal operations and records action status
- action execution saves and dismisses individual listings through the ledger
- action execution rejects actions outside the owned thread
- action execution rejects stale map and listing ledger revisions
- action execution ignores client-supplied listing/proposal identifiers that do not match the stored action target

E2E tests:

- user asks for researched pins and sees a chat action card
- applying the card adds pins to the map
- user asks for listings and sees listing result cards
- saving and dismissing listings updates card state and ledger state
- chat persists after refresh
- reset clears chat, pending actions, and listing/map state for the current app reset flow
- copying only a thread id without the installation secret cannot load or mutate the thread

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
- Responses API server-managed state can be useful later, but v1 should pass app-built context each turn instead of depending on `previous_response_id` while using `store: false`.
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
