# Persistent Accounts Design

## Goal

Move SF Apartment Hunt from browser-local persistence to account-backed durable persistence so a signed-in user can access the same map, listings, planning chat, and future Facebook imports across devices.

The first durable version should not try to migrate every existing local browser state automatically. Signed-in users start with a fresh default workspace. JSON import/export remains the manual bridge for old maps or alternate versions.

## Current State

The product is local-first and anonymous:

- `sf-apt-hunt:map-state:v1` stores zones, corridors, target pins, manual edits, and imported map JSON.
- `sf-apt-hunt:listing-ledger:v1` stores seen/saved/dismissed listing leads, latest candidate payloads, and geocode updates.
- `sf-apt-hunt:planning-thread-cache:v1` stores the current planning chat thread, messages, action records, context summaries, map snapshot revision, and listing ledger revision.
- `sf-apt-hunt:planning-installation:v1` stores a browser-generated installation id and secret used as de facto anonymous ownership for planning chat state.
- `sf-apt-hunt:geocode-cache:v1` stores browser-side geocode lookups.
- `sf-apt-hunt:geocode-session:v1` stores browser-side geocode session state.
- `sf-apt-hunt:openai-key` stores the user's BYO OpenAI key client-side.

This works for a single browser, but it blocks cross-device continuity and makes the planned Facebook browser extension awkward. An extension should be able to save reviewed listing captures into the same durable listing system without relying on one tab's localStorage.

## Chosen Direction

Use account-backed workspaces for signed-in users.

- Auth: Better Auth.
- Sign-in provider: Google OAuth only in v1.
- Database: Neon Postgres.
- ORM and migrations: Drizzle.
- Workspace model: one default workspace per user in v1.
- Source of truth: Postgres for signed-in users.
- Local storage role: temporary UI/cache state only, not durable source of truth.

Better Auth owns authentication state. Apt Hunt owns product state keyed by `userId` and `workspaceId`.

## Non-Goals

- Automatic migration from old localStorage into accounts.
- Multiple workspaces per user in v1.
- Organization/team accounts.
- Email/password auth in v1.
- Storing the user's OpenAI API key server-side in v1.
- Building the Facebook extension in this persistence slice.
- Replacing JSON import/export.

## Auth Design

Better Auth should be mounted at:

```txt
/api/auth/[...all]
```

V1 enables only Google OAuth. Required local redirect URI:

```txt
http://localhost:3333/api/auth/callback/google
```

The production redirect URI must use the deployed app origin with the same `/api/auth/callback/google` callback path.

Required environment variables:

```txt
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

The app shell should show a compact signed-out state with a Google sign-in action. After sign-in, the server creates or loads the user's default workspace.

## Database Model

Use Drizzle as the source of truth for schema and migrations. Better Auth tables and Apt Hunt tables live in the same Neon database.

Better Auth tables:

```txt
user
session
account
verification
```

Apt Hunt tables:

```txt
workspace
map_snapshot
listing_lead
planning_thread
planning_message
planning_action
planning_action_execution
geocode_cache_entry
facebook_listing_capture
```

### `workspace`

One row per user in v1.

```ts
type Workspace = {
  id: string;
  userId: string;
  name: string;
  listingLedgerRevision: string;
  createdAt: Date;
  updatedAt: Date;
};
```

The database must enforce `unique(workspace.userId)` in v1. The first signed-in request creates the default workspace with a transactional insert-or-get operation:

```sql
insert into workspace (user_id, name, listing_ledger_revision)
values ($1, 'Apartment hunt', $2)
on conflict (user_id) do update set updated_at = workspace.updated_at
returning *;
```

The implementation can use the Drizzle equivalent, but it must rely on the unique constraint and transaction semantics rather than a read-then-insert race. Concurrent first loads must return the same workspace.

### `map_snapshot`

Stores the current workspace map state plus a revision.

```ts
type MapSnapshotRow = {
  id: string;
  workspaceId: string;
  revision: string;
  mapState: MapState;
  createdAt: Date;
  updatedAt: Date;
};
```

V1 can keep only the current snapshot row per workspace. The database must enforce `unique(map_snapshot.workspaceId)` for the current snapshot. A future version can add historical snapshots or named map versions.

Map writes must use compare-and-set semantics:

- client sends `expectedMapRevision`
- server updates only when the current revision matches
- successful writes generate and return a new `mapSnapshot.revision`
- stale writes return `409 Conflict` with the current revision

### `listing_lead`

Stores the durable listing ledger.

```ts
type ListingLeadRow = {
  id: string;
  workspaceId: string;
  canonicalUrl: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSearchQuery: string;
  seenCount: number;
  status: "new" | "seen" | "saved" | "dismissed";
  candidate: ListingCandidate;
  createdAt: Date;
  updatedAt: Date;
};
```

`workspaceId + canonicalUrl` is unique. Reappearing listings update the latest candidate and lifecycle metadata without losing saved/dismissed status.

Listing mutations must update `workspace.listingLedgerRevision` in the same transaction as `listing_lead` changes. Clients send `expectedListingLedgerRevision` for status updates, geocode candidate updates, planning listing actions, and imports that create or update leads. Stale listing mutations return `409 Conflict` with the current ledger revision.

### `planning_thread`, `planning_message`, `planning_action`, `planning_action_execution`

Move planning chat history and action state out of browser storage and memory store.

The existing `PlanningThread`, `PlanningMessage`, `PlanningActionRecord`, and `PlanningActionExecutionRecord` domain contracts should map closely to these rows, but the persisted rows must be workspace-owned. The old `clientInstallationId` field does not prove ownership for signed-in users and should not be part of the DB ownership model.

```ts
type PlanningThreadRow = {
  id: string;
  workspaceId: string;
  title: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
};

type PlanningMessageRow = {
  id: string;
  workspaceId: string;
  threadId: string;
  role: "user" | "assistant";
  parts: PlanningChatPart[];
  contextSummary: PlanningContextSummary | null;
  createdAt: Date;
};

type PlanningActionRow = {
  id: string;
  workspaceId: string;
  threadId: string;
  messageId: string;
  partIndex: number;
  kind: PlanningActionRecord["kind"];
  target: PlanningActionTarget;
  status: PlanningActionStatus;
  error: string | null;
  failureKind: PlanningActionFailureKind | null;
  createdAt: Date;
  updatedAt: Date;
};

type PlanningActionExecutionRow = {
  id: string;
  workspaceId: string;
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: "succeeded" | "failed";
  error: string | null;
  createdAt: Date;
};
```

Required constraints and indexes:

- `planning_thread.workspaceId` references `workspace.id on delete cascade`
- `planning_message.workspaceId` references `workspace.id on delete cascade`
- `planning_message.threadId` references `planning_thread.id on delete cascade`
- `planning_action.workspaceId` references `workspace.id on delete cascade`
- `planning_action.threadId` references `planning_thread.id on delete cascade`
- `planning_action.messageId` references `planning_message.id on delete cascade`
- `planning_action_execution.workspaceId` references `workspace.id on delete cascade`
- `planning_action_execution.actionId` references `planning_action.id on delete cascade`
- index `planning_thread(workspaceId, updatedAt)`
- index `planning_message(workspaceId, threadId, createdAt)`
- index `planning_action(workspaceId, threadId, status)`
- unique `planning_action_execution(actionId, idempotencyKey)`
- index `planning_action_execution(workspaceId, actionId)`

Reset/delete behavior:

- workspace reset deletes planning threads, messages, actions, and executions for that workspace before creating fresh planning state
- workspace delete cascades through all planning rows
- map revision changes mark pending map-bound actions stale rather than deleting chat history

Planning action execution must use authenticated ownership:

- request user must own the workspace
- thread must belong to the workspace
- action must belong to the thread
- map/listing revisions must still match before mutation

This replaces `clientInstallationId` and `x-sf-apt-installation-secret` for signed-in users.

### `geocode_cache_entry`

Stores workspace-scoped geocode results by canonical query hash.

```ts
type GeocodeCacheEntry = {
  id: string;
  workspaceId: string;
  queryHash: string;
  query: string;
  result: Partial<ListingCandidate>;
  createdAt: Date;
  updatedAt: Date;
};
```

The database must enforce `unique(geocode_cache_entry.workspaceId, geocode_cache_entry.queryHash)`.

Geocoded listing coordinates and status should also persist back to `listing_lead.candidate`, so a saved lead remains renderable even if the cache entry is evicted later. The geocode cache write and listing lead candidate update must happen in the same transaction and must advance `workspace.listingLedgerRevision`.

### `facebook_listing_capture`

Reserved for the later browser extension. This table should be designed now so listing details can evolve without changing the core lead ledger.

```ts
type FacebookListingCaptureRow = {
  id: string;
  workspaceId: string;
  sourceSurface: "homeFeed" | "groupFeed" | "postPermalink";
  sourceGroupId: string;
  sourceGroupName: string;
  sourceGroupUrl: string;
  sourcePostUrl: string;
  capturedText: string;
  capturedAt: Date;
  parsedDraft: HousingDetails | null;
  reviewedDetails: HousingDetails | null;
  incompleteFlags: string[];
  listingLeadId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

`sourcePostUrl` should become the canonical URL for the normalized listing lead.

```ts
type HousingDetails = {
  listingType:
    | "full_apartment"
    | "private_room"
    | "shared_room"
    | "roommate_search"
    | "unknown";
  tenancyType:
    | "new_lease"
    | "lease_takeover"
    | "sublet"
    | "month_to_month"
    | "unknown";
  priceMonthly: number | null;
  bedrooms: number | "studio" | null;
  bathroom: "private" | "shared" | "unknown";
  roommateCount: number | null;
  locationText: string | null;
  neighborhoodGuess: string;
  availabilityStart: string | null;
  availabilityEnd: string | null;
  dateFlexibility: "fixed" | "flexible" | "unknown";
  durationText: string | null;
  furnished: boolean | null;
  pets: "allowed" | "not_allowed" | "unknown";
};
```

Incomplete Facebook imports are valid. Missing price, location, dates, tenancy type, bathroom, or roommates become caveats and reduce available scoring signals, but they do not block saving.

## Signed-In App Behavior

When signed in:

1. Server resolves the user session.
2. Server creates or loads the user's default workspace.
3. App loads map state from `map_snapshot`.
4. App loads listing leads from `listing_lead`.
5. App loads planning chat history/action state from planning tables.
6. All edits and action clicks write through authenticated API routes or server actions.

The default workspace starts with the current clean planning map:

- neighborhood outlines are present
- no seed pins
- no seed corridors

JSON import replaces the current workspace `map_snapshot`. JSON export reads the current DB map state.

Every successful map revision change is a planning-action invalidation boundary. This includes normal `PUT /api/workspace/map` edits, JSON import, planning map actions, and workspace reset. In the same transaction that writes the new map revision, the server must mark pending map-bound planning actions as permanently failed when their target references the old map revision:

- `mapProposal`
- `mapProposalItem`
- `targetEdit`

The failure error should be user-readable and specific to the mutation, for example `Map changed before this proposal was applied.` or `Map was replaced by JSON import.` Listing save/dismiss actions are unaffected unless their listing ledger revision is stale. The chat history stays visible, but stale map action cards render disabled through their updated action status.

## Local Storage Boundary

For signed-in users, browser storage must not be the durable source of truth.

Allowed browser storage:

- BYO OpenAI key, unless a later feature adds encrypted key storage.
- Ephemeral UI state such as expanded panels, selected local controls, or optimistic cache.
- Temporary recovery cache that can be discarded without data loss.

Not allowed as signed-in source of truth:

- map state
- listing ledger
- planning thread/action ownership
- geocode results required for rendering saved leads
- Facebook imports

The old localStorage wrappers can remain for unsigned/dev mode during transition, but feature code should route signed-in reads/writes through a workspace persistence adapter.

## Persistence Adapter Boundary

Add a small persistence boundary rather than scattering DB calls through UI components.

Recommended modules:

```txt
lib/db/schema.ts
lib/db/client.ts
lib/server/auth.ts
lib/server/workspaces.ts
lib/server/workspace-state.ts
lib/server/listing-leads-db.ts
lib/server/planning/store-db.ts
```

During the transition, the app has two implementations behind similar concepts:

- local/dev persistence using existing storage wrappers
- signed-in DB persistence using Drizzle

The signed-in path is canonical. The local path is compatibility/dev support.

## API Changes

Add authenticated workspace routes for the signed-in path. Route contracts must include revisions so multi-tab and cross-device edits do not silently overwrite each other.

```txt
GET /api/workspace
PUT /api/workspace/map
POST /api/workspace/map/import
GET /api/workspace/map/export
GET /api/workspace/listings
PATCH /api/workspace/listings/:id
POST /api/workspace/geocode-cache
POST /api/workspace/reset
DELETE /api/workspace
```

Core route contracts:

```ts
type WorkspaceResponse = {
  workspace: Workspace;
  mapSnapshot: MapSnapshotRow;
  listingLedgerRevision: string;
};

type PutWorkspaceMapRequest = {
  expectedMapRevision: string;
  mapState: MapState;
};
type PutWorkspaceMapResponse =
  | {
      ok: true;
      mapSnapshot: MapSnapshotRow;
      invalidatedActionIds: string[];
    }
  | { ok: false; error: "stale_map_revision"; currentMapRevision: string };

type ImportWorkspaceMapRequest = {
  expectedMapRevision: string;
  mapState: MapState;
};
type ImportWorkspaceMapResponse =
  | {
      ok: true;
      mapSnapshot: MapSnapshotRow;
      invalidatedActionIds: string[];
    }
  | { ok: false; error: "stale_map_revision"; currentMapRevision: string };

type ListingsResponse = {
  leads: ListingLead[];
  listingLedgerRevision: string;
};

type PatchListingRequest = {
  expectedListingLedgerRevision: string;
  status: "saved" | "dismissed";
};
type PatchListingResponse =
  | { ok: true; lead: ListingLead; listingLedgerRevision: string }
  | {
      ok: false;
      error: "stale_listing_ledger_revision";
      currentListingLedgerRevision: string;
    };

type PostGeocodeCacheRequest = {
  expectedListingLedgerRevision: string;
  canonicalUrl: string;
  queryHash: string;
  query: string;
  result: {
    coordinates: Coordinate | null;
    geocodeQuery: string | null;
    geocodeStatus:
      | "not_attempted"
      | "geocoded_exact"
      | "geocoded_approximate"
      | "failed"
      | "outside_sf";
    locationConfidence: ListingCandidate["locationConfidence"];
    markerPrecision: ListingCandidate["markerPrecision"];
    locationText: string | null;
    neighborhoodGuess: string;
  };
};
type PostGeocodeCacheResponse =
  | {
      ok: true;
      lead: ListingLead;
      cacheEntry: GeocodeCacheEntry;
      listingLedgerRevision: string;
    }
  | {
      ok: false;
      error: "stale_listing_ledger_revision";
      currentListingLedgerRevision: string;
    }
  | { ok: false; error: "listing_not_found" };

type WorkspaceResetRequest = {
  expectedMapRevision: string;
  expectedListingLedgerRevision: string;
  confirmation: "reset";
};
type WorkspaceResetResponse =
  | {
      ok: true;
      workspace: Workspace;
      mapSnapshot: MapSnapshotRow;
      listingLedgerRevision: string;
    }
  | {
      ok: false;
      error: "stale_workspace_revision";
      currentMapRevision: string;
      currentListingLedgerRevision: string;
    };

type DeleteWorkspaceRequest = {
  confirmation: "delete";
};
type DeleteWorkspaceResponse = { ok: true };
```

Status codes:

- `401` when no valid session exists
- `403` when the authenticated user does not own the workspace/thread/action
- `409` for stale map or listing revisions
- `400` for invalid request bodies

`POST /api/workspace/reset` deletes product data for the current default workspace, recreates the clean default map, clears listing leads, geocode cache entries, Facebook captures, planning messages/actions, and returns fresh revisions. `DELETE /api/workspace` deletes the current default workspace and all product rows; the next signed-in load creates a new default workspace. Both routes require explicit confirmation strings and authenticated ownership.

Planning chat routes should use authenticated workspace ownership:

```txt
POST /api/ai/planning-chat
POST /api/planning/actions/execute
POST /api/planning/reset
```

The routes can continue to support anonymous/local development during transition, but the persistent signed-in code path should not use installation-secret ownership.

Cookie-authenticated mutating routes must also enforce a CSRF/origin policy. Server-side session validation is required, but it is not sufficient by itself for `POST`, `PUT`, `PATCH`, or `DELETE` routes.

For app-origin requests:

- require `Origin` to match `BETTER_AUTH_URL` or the configured deployment origin
- reject cross-site `Sec-Fetch-Site` values when the header is present
- validate the Better Auth session server-side before reading or writing workspace data

The future browser extension import route must not rely on ambient cookies alone. It should use a same-origin app-minted short-lived import token or another explicit extension authorization handshake before accepting `chrome-extension://` requests.

## OpenAI Key Policy

Keep the current BYO OpenAI key posture for v1 persistence.

- The key is passed as a bearer token from the browser to AI routes.
- Server forwards it to OpenAI with `store: false`.
- Server never stores, logs, or echoes the key.
- Browser may keep the key locally for convenience.

The database migration should not add server-side OpenAI key storage.

## Facebook Extension Path

The extension should wait until DB persistence exists.

V1 extension flow after persistence:

1. User signs into Apt Hunt.
2. User allowlists Facebook groups in the extension.
3. Extension injects `Save to Apt Hunt` only on posts with recognized allowlisted group context.
4. Extension captures post text, group metadata, post URL, and timestamp.
5. LLM parsing produces editable draft housing details.
6. User clicks `Save reviewed` or `Save incomplete`.
7. Extension posts to authorized `POST /api/imports/facebook-listings` using the extension import-token handshake defined in that later slice.
8. Server writes `facebook_listing_capture`.
9. Server creates or updates a normalized `listing_lead`.
10. App displays the listing across devices with partial scoring if fields are missing.

The extension should not scrape automatically in v1. Saving is user initiated per post.

The persistence slice does not implement the extension API. When the extension slice starts, add:

```txt
POST /api/imports/facebook-listings
```

That route must define an explicit extension authorization handshake before implementation. The preferred shape is:

1. signed-in app creates a short-lived import token for the extension
2. extension sends the reviewed or incomplete capture with that token
3. server validates token, workspace ownership, allowed source group metadata, and request schema
4. server writes `facebook_listing_capture`
5. server creates or updates `listing_lead`
6. server advances `listingLedgerRevision`

The route must not rely on ambient cookies alone for `chrome-extension://` requests.

## Security And Privacy

- Every DB read/write is scoped by authenticated `userId` and `workspaceId`.
- API routes validate request bodies with Zod.
- Mutating cookie-authenticated routes enforce same-origin/CSRF checks in addition to session validation.
- DB JSON payloads are parsed through domain schemas before use.
- Planning actions remain reviewable and idempotent.
- Facebook captured text is user-provided imported content and must be treated as untrusted text.
- Rendered source URLs remain validated `http`/`https` URLs.
- Reset/delete workspace data must require authenticated ownership.
- Workspace reset/delete routes require explicit confirmation strings and must delete or replace all workspace-scoped product rows transactionally.
- Google OAuth secrets, Better Auth secret, and Neon connection strings are server-only.

## Rollout Plan

1. Add Drizzle, Neon connection, and schema/migration setup.
2. Add Better Auth with Google OAuth.
3. Add default workspace creation.
4. Add DB-backed map snapshot read/write.
5. Add DB-backed listing ledger read/write.
6. Add DB-backed planning store.
7. Replace planning installation ownership with session/workspace ownership for signed-in users.
8. Update JSON import/export to operate on DB state when signed in.
9. Add workspace reset/delete routes.
10. Persist geocode updates to DB.
11. Keep local/dev mode working until the signed-in path is stable.
12. After this slice is stable, implement the Facebook extension import flow.

## Testing

Unit tests:

- Drizzle schema exports valid app table definitions.
- Workspace creation is idempotent for a user.
- Workspace schema enforces `unique(userId)`.
- Workspace first-load helper uses insert-or-get semantics and returns one row under concurrent calls.
- Listing lead upsert preserves saved/dismissed status on reappearance.
- Map snapshot revision changes after writes.
- Stale map writes return `409`.
- Stale listing mutations return `409`.
- Geocode cache write upserts `unique(workspaceId, queryHash)`, updates the matching listing lead candidate, and advances `listingLedgerRevision` in one transaction.
- Planning table schema includes workspace foreign keys, ownership indexes, and cascade constraints.
- Planning action execution rejects wrong workspace ownership.
- Geocode cache entries are workspace scoped.
- Facebook housing details schema accepts incomplete reviewed details.

Route tests:

- Signed-out workspace routes reject with 401.
- Signed-in workspace route creates a default workspace.
- Mutating workspace routes reject mismatched cross-site origins.
- Normal map writes replace DB map snapshot, return the new revision, and invalidate pending map actions tied to the old revision.
- Map import replaces DB map snapshot, returns the new revision, and invalidates pending map actions tied to the old revision.
- Listing status update persists to DB.
- Listing status update requires and advances `listingLedgerRevision`.
- Geocode cache route requires `expectedListingLedgerRevision`, returns `409` on stale revision, and keeps cache and listing lead fields aligned.
- Planning chat reads/writes DB-backed thread state.
- Planning action execution uses authenticated ownership rather than installation secret.
- Workspace reset deletes planning rows through workspace-scoped cascade behavior.
- Workspace reset clears map, listings, geocode cache, Facebook captures, planning messages/actions, and returns fresh revisions.
- Workspace delete removes the default workspace for the authenticated user and the next load creates a clean workspace.

End-to-end tests:

- Signed-in user sees empty clean map on first load.
- Creating/editing pins and corridors persists after reload.
- Saved/dismissed listing status persists after reload.
- Planning chat history/action state persists after reload.
- JSON import populates the signed-in workspace.
- Same signed-in account in a second browser context sees the same map and listing state.

Manual verification:

- Google OAuth local redirect works at `http://localhost:3333/api/auth/callback/google`.
- Neon database migrations run cleanly.
- Browser refresh and separate browser profile both show DB-backed state for the same account.

## Sources

- Better Auth Google provider docs: https://www.better-auth.com/docs/authentication/google
- Better Auth Drizzle adapter docs: https://www.better-auth.com/docs/adapters/drizzle
- Better Auth OAuth concepts: https://www.better-auth.com/docs/concepts/oauth
- Drizzle migrations docs: https://orm.drizzle.team/docs/migrations
- Drizzle PostgreSQL guide: https://orm.drizzle.team/docs/get-started/postgresql-new
