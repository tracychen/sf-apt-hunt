# Facebook Listing Extension Design

## Context

The app now has signed-in workspaces backed by Better Auth, Drizzle, and Postgres. Listing leads, geocode cache entries, planning chat state, and map state are durable per workspace. The persistence design already reserves `facebook_listing_capture` for a later browser extension and explicitly says extension imports should not rely on ambient cookies alone.

The extension should help a signed-in user save rental posts from Facebook groups into the same listing system they use on the website. It should not create a separate account, scrape automatically, or maintain a parallel source of truth.

Chrome platform assumptions checked against current docs:

- Manifest V3 content scripts can read and modify matching page DOM and message the extension runtime.
- `chrome.storage` is the extension-specific persistence API; sensitive connection data should stay in trusted extension contexts rather than content scripts.
- `externally_connectable` lets the website communicate with the extension when the manifest allowlists the app origin.

Sources:

- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome storage API: https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome `externally_connectable`: https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable

## Goals

- Use the same signed-in website account and default workspace for extension saves.
- Let users allowlist relevant Facebook groups from the extension.
- Add a `Save to Apt Hunt` action to posts from allowlisted groups, including posts surfaced on the Facebook home feed when group context is visible.
- Capture enough listing data to create or update a durable listing lead.
- Allow saving incomplete captures.
- Support full apartments, private rooms, shared rooms, roommate searches, lease takeovers, sublets, month-to-month, and unknown tenancy details.
- Keep all imported listing data in the existing workspace listing ledger and `facebook_listing_capture` table.

## Non-Goals

- No auto-scrolling or bulk scraping in V1.
- No separate extension account or Google OAuth flow.
- No server-side OpenAI key storage.
- No Chrome Web Store publishing flow in this slice.
- No broad saved-leads redesign. Imported Facebook leads should appear through the existing listing lead surfaces first.

## Product Flow

### Connect

1. User installs the extension.
2. Extension popup shows `Connect Apt Hunt`.
3. Clicking it opens the website connect page, for example `/extension/connect?extensionId=<chrome.runtime.id>`.
4. If the user is not signed in, the website sends them through the existing app login and returns to the connect page.
5. The signed-in connect page calls a same-origin API route to mint an extension connection token for the user's default workspace.
6. The page sends the token to the extension with `chrome.runtime.sendMessage(extensionId, ...)`.
7. The extension background service worker validates the sender origin, stores the connection in trusted extension storage, and shows `Connected as <email>`.

The extension token is not a login session. It is a scoped API credential for Facebook listing import only. Website login remains the source of account identity.

The website must not trust arbitrary `extensionId` values from the query string. Before minting, the server validates that the id has Chrome's extension id shape and appears in a server-side allowlist for this deployment. A malicious extension can allowlist the app origin in its own `externally_connectable` manifest, so app-side allowlisting is the ownership check that decides which extension ids can receive import tokens.

### Allowlist

The popup has an allowlist manager:

- `Add current group` when the active tab is a Facebook group page.
- Manual add/edit for group URL and display name.
- Remove group.
- Show connection status and sync target email/workspace name.

Allowlist entries live in extension storage and are included with each save request. The server also validates that incoming captures include group metadata, but V1 does not need a server-side group allowlist unless abuse or multi-device extension sync requires it.

### Save A Post

1. A content script runs on `https://www.facebook.com/*`.
2. It observes feed/post DOM changes and identifies post containers.
3. For each post, it attempts to derive group context:
   - group feed page URL,
   - post permalink with group URL/id,
   - visible group attribution in home feed.
4. If the group matches the extension allowlist, inject `Save to Apt Hunt`.
5. Clicking the button captures visible post text, source URL, group metadata, author/display metadata if available, and timestamp.
6. Extension opens a small review/edit surface. V1 should use an extension-owned popup window or side panel launched by the background worker, not a raw Facebook DOM form, so token-bearing save calls stay in trusted extension code.
7. The popup can run local LLM parsing if the user has provided an OpenAI key to the extension, but parsing is optional.
8. User clicks `Save reviewed` or `Save incomplete`.
9. Extension sends the capture to the app import API with the extension token.
10. Server writes `facebook_listing_capture`, upserts `listing_lead`, advances `listingLedgerRevision`, and returns the updated lead.

## Extension Architecture

Use a Manifest V3 extension with these parts:

- `manifest.json`
  - `manifest_version: 3`
  - `permissions`: `storage`, `activeTab` if needed, and minimal permissions for messaging.
  - `host_permissions`: `https://www.facebook.com/*`, local dev app URL, production app URL.
  - `content_scripts`: Facebook content script plus CSS.
  - `background.service_worker`: connection, token storage, import requests, and parsing orchestration.
  - `action.default_popup`: extension popup for connection and allowlist.
  - `externally_connectable.matches`: app origins, including `http://localhost/*` in dev and production origin later. Chrome match patterns do not include ports; app-side origin checks still enforce the actual dev origin such as `http://localhost:3333`.

- Content script
  - DOM observer for post containers.
  - Group-context detector.
  - Save button injection.
  - Capture serializer.
  - No direct access to extension token.

- Background service worker
  - Owns the extension connection token.
  - Receives messages from content script and popup.
  - Calls app APIs.
  - Optionally calls OpenAI for parsing with a browser-local extension key.

- Popup/review UI
  - Connection status.
  - Allowlist management.
  - Review/edit listing draft.
  - Save success/failure feedback.
  - Runs in an extension page or side panel. It receives a capture id from the background worker and asks the background worker to save; it does not embed long-lived secrets into Facebook page DOM.

## App Architecture

Add app routes and helpers:

### `GET /extension/connect`

Client page that requires a signed-in app session. It receives `extensionId`, shows the target account/workspace, and lets the user connect or cancel.

The page must reject invalid or unrecognized extension ids before showing a connect action. It may show the requested extension id and a generic "extension not recognized" message, but it must not expose the full server allowlist.

### `POST /api/extension/connections`

Same-origin, cookie-authenticated route.

Request:

```ts
type CreateExtensionConnectionRequest = {
  extensionId: string;
};
```

Response:

```ts
type CreateExtensionConnectionResponse =
  | {
      ok: true;
      token: string;
      expiresAt: string;
      account: {
        email: string;
      };
      workspace: {
        id: string;
        name: string;
      };
    }
  | { ok: false; error: "unauthorized" | "invalid_request" | "extension_not_allowed" };
```

Route requirements:

- Validate body with Zod.
- Validate `extensionId` with the Chrome extension id shape, `^[a-p]{32}$`.
- Require the extension id to be present in a server-side allowlist, for example `EXTENSION_ALLOWED_IDS`.
- Require signed-in session.
- Enforce same-origin request policy.
- Create the default workspace if missing.
- Store only a hash of the token server-side.
- Scope token to `workspaceId`, `userId`, extension id, and `facebook_listing_import`.
- Expire tokens. Suggested V1: 30 days with renewal through reconnect.

### `DELETE /api/extension/connections/current`

Same-origin route for disconnecting from the website. It revokes active tokens for the current user/workspace.

### `DELETE /api/extension/connections/token`

Extension-authenticated route for popup disconnect. It uses the bearer token and extension id header, revokes the matching token, and returns success once future imports with that token will fail.

Headers:

```txt
Authorization: Bearer <extension-import-token>
X-SF-Apt-Extension-Id: <chrome.runtime.id>
```

Response:

```ts
type RevokeExtensionTokenResponse =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "token_expired" | "invalid_request" };
```

The extension popup should call this route before deleting local connection state. If the browser is offline or the request times out, the popup marks the connection as `disconnect_pending` and retries revocation before allowing future imports.

### `POST /api/imports/facebook-listings`

Extension-authenticated route. It must not rely on app cookies.

Headers:

```txt
Authorization: Bearer <extension-import-token>
X-SF-Apt-Extension-Id: <chrome.runtime.id>
```

Request:

```ts
type FacebookListingImportRequest = {
  idempotencyKey: string;
  sourceSurface: "homeFeed" | "groupFeed" | "postPermalink";
  sourceGroupId: string;
  sourceGroupName: string;
  sourceGroupUrl: string;
  sourcePostUrl: string;
  capturedText: string;
  capturedAt: string;
  parsedDraft: HousingDetails | null;
  reviewedDetails: HousingDetails | null;
  incompleteFlags: string[];
};
```

Response:

```ts
type FacebookListingImportResponse =
  | {
      ok: true;
      captureId: string;
      lead: ListingLead;
      listingLedgerRevision: string;
    }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "token_expired"
        | "invalid_request"
        | "invalid_group_context"
        | "idempotency_conflict"
        | "import_failed";
    };
```

Route requirements:

- Validate token hash, expiry, extension id, user ownership, and workspace ownership.
- Validate request body with Zod and strict schemas.
- Require `idempotencyKey` to be a client-generated UUID created when the user clicks save.
- Body cap: 64 KB for V1.
- Require HTTPS `sourceGroupUrl` and `sourcePostUrl` on `facebook.com`.
- Treat `capturedText` as untrusted text.
- Upsert by `(workspaceId, sourcePostUrl)` to avoid duplicate saves.
- Store a payload hash for `(workspaceId, idempotencyKey)`. Replaying the same key and same payload returns the original successful response without incrementing `seenCount`, rewriting capture details, or advancing the ledger revision. Reusing the same key with a different payload returns `409 idempotency_conflict`.
- Write `facebook_listing_capture`.
- Create or update `listing_lead` with `sourcePostUrl` as `canonicalUrl`.
- Advance `workspace.listingLedgerRevision` in the same transaction.

## Data Model

Existing `facebook_listing_capture` is close to the target shape. V1 should add or confirm:

- Unique index on `(workspaceId, sourcePostUrl)`.
- Shared `HousingDetails` moves from `lib/db/schema.ts` into domain types/schemas and adds `notes: string[]` with the same text/count limits used by the rest of the app. Review notes map into both `facebook_listing_capture.reviewedDetails.notes` and generated listing candidate caveats.
- Token table, for example `extension_connection_token`:

```ts
type ExtensionConnectionTokenRow = {
  id: string;
  userId: string;
  workspaceId: string;
  extensionId: string;
  tokenHash: string;
  scope: "facebook_listing_import";
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Import idempotency table:

```ts
type FacebookListingImportAttemptRow = {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  payloadHash: string;
  captureId: string;
  listingLeadId: string;
  successfulResponse: {
    captureId: string;
    leadCanonicalUrl: string;
    listingLedgerRevision: string;
  };
  createdAt: Date;
};
```

The database must enforce `unique(workspaceId, idempotencyKey)`.

## Listing Lead Normalization

Facebook imports should produce a `ListingLead` even when incomplete:

- `canonicalUrl`: `sourcePostUrl`
- `lastSearchQuery`: `"facebook import"`
- `status`: `"saved"` by default because the user explicitly saved it
- `seenCount`: increment on duplicate save
- candidate:
  - `title`: derived from location/type/price when possible, otherwise `Facebook listing`
  - `url`: `sourcePostUrl`
  - `sourceDomain`: `facebook.com`
  - `neighborhoodGuess`: reviewed details, parsed draft, or `"Unknown"`
  - `locationText`: reviewed details, parsed draft, or null
  - `priceMonthly`: reviewed details, parsed draft, or null
  - `beds`: map studio/1br when clear, otherwise `"unknown"` for roommate/shared cases until listing candidate types become richer
  - `shortTermSignal`: true for sublet/month-to-month or bounded end date
  - `furnishedSignal`: reviewed/parsed furnished true
  - `fitScore`: conservative default, then existing scoring can improve when map/geocode details exist
  - `caveats`: include reviewed notes, missing required signals, and parser uncertainty

V1 can preserve richer room/tenancy metadata in `facebook_listing_capture.reviewedDetails` even if `ListingCandidate` remains narrower.

## Parsing

Parsing is optional for saving.

V1 parser behavior:

- Extension review popup can provide `Parse with AI`.
- The OpenAI key remains browser-local to the extension and is never stored server-side.
- Parser output must conform to a strict JSON schema matching `HousingDetails`.
- User can edit every parsed field before save.
- `Save incomplete` skips parser and sends `reviewedDetails: null` plus incomplete flags.

The server should trust neither parsed nor reviewed details blindly; it validates shape, length limits, URL host, and allowed enum values.

## Security And Privacy

- Same app login owns website session and workspace.
- Connect token minting requires an allowed Chrome extension id. Valid ids match `^[a-p]{32}$` and must be listed in server configuration for the deployment.
- Extension token is scoped, expiring, revocable, and hash-stored.
- Extension imports use bearer token auth, not ambient website cookies.
- Website connect uses same-origin session and CSRF/origin checks.
- Extension background service worker stores the token in trusted extension storage only; content scripts never receive it. Where Chrome supports storage access levels, set extension-local token storage to trusted contexts only.
- Content script only injects on Facebook and only shows save controls for allowlisted group context.
- No automatic scraping or hidden background collection.
- Captured post text is user-imported untrusted content and must be escaped when rendered.
- Popup disconnect uses the extension-authenticated revoke route before clearing local connection state. Website disconnect, workspace reset, and workspace/account delete also revoke extension tokens and stop future imports.

## UX Details

Popup compact states:

- Signed out / disconnected: `Connect Apt Hunt`.
- Connected: account email, workspace name, `Disconnect`.
- Facebook group page: `Add current group`.
- Home feed or post page: show whether the current visible post group can be recognized.
- Settings: allowlisted groups list.

Injected save button:

- Small `Save to Apt Hunt` button near existing post actions.
- Saved state changes to `Saved`.
- Duplicate post save opens review with existing details and indicates it will update the saved listing.

Review popup fields:

- Price/month
- Listing type
- Tenancy type
- Start date
- End date
- Date flexibility
- Duration
- Location/neighborhood
- Bedrooms
- Bathroom
- Roommates
- Furnished
- Pets
- Notes/caveats

`Notes/caveats` maps to `HousingDetails.notes` and then into listing candidate caveats. It is not a free-floating UI-only field.

## Testing

Unit tests:

- Extension group URL parser.
- Home-feed visible group attribution parser with fixtures.
- Capture serializer.
- HousingDetails schema validation.
- HousingDetails notes map into listing candidate caveats.
- Listing lead normalization from full and incomplete captures.
- Token hash/expiry/revocation validation.

Route tests:

- Connect route rejects signed-out and cross-site requests.
- Connect route mints a token for the signed-in default workspace.
- Import route rejects missing, expired, revoked, wrong-extension, and malformed tokens.
- Connect route rejects disallowed extension ids and invalid extension id shapes.
- Extension-authenticated disconnect revokes the active token and prevents later imports.
- Import route rejects non-Facebook URLs.
- Import route upserts duplicate post URL.
- Import route treats same-key retry as idempotent and same-key/different-payload as a conflict.
- Import route writes capture and listing lead in one transaction and advances ledger revision.

E2E/manual extension tests:

- Load unpacked extension in Chrome.
- Connect extension to local signed-in app.
- Add a Facebook group to allowlist.
- Save a fixture post from a group page.
- Save a fixture post from a home-feed-like page with group attribution.
- Confirm saved lead appears in the app after refresh.

## Rollout

1. Spec and implementation plan.
2. App-side import token and Facebook import API.
3. Extension scaffold with popup, background worker, storage, and connect flow.
4. Content script with allowlist and save button injection.
5. Review popup and incomplete save.
6. Optional LLM parse.
7. Local manual test instructions.
8. Later: packaging and Chrome Web Store review.

## Implementation Notes

- Use a new top-level `extension/` directory so the web app build remains isolated.
- Keep shared schemas in `lib/domain` and import them from app server code. The extension can copy or generate a narrow JSON schema for parser validation rather than importing server-only modules.
- If the extension build needs TypeScript bundling, add the smallest explicit build tool for `extension/` instead of coupling it to Next.
- Add local development constants for `http://localhost:3333` and leave production origin configurable.
