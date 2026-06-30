# Facebook Listing Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome Manifest V3 extension that saves user-reviewed Facebook rental posts into the signed-in Apt Hunt workspace listing ledger.

**Architecture:** App-owned auth remains the source of identity. The website mints hash-stored, revocable, workspace-scoped extension import tokens for allowlisted Chrome extension ids, and extension imports write through server routes into `facebook_listing_capture` and `listing_lead`. The extension is a plain MV3 JavaScript app under `extension/` with a background service worker, popup, content script, and review page.

**Tech Stack:** Next.js 16 App Router, React 19, Better Auth, Drizzle/Postgres, Zod, Vitest, Playwright, Chrome Manifest V3 JavaScript.

## Global Constraints

- Use the same signed-in website account and default workspace for extension saves.
- No auto-scrolling or bulk scraping in V1.
- No separate extension account or Google OAuth flow.
- No server-side OpenAI key storage.
- Extension AI parsing uses the user's extension-local OpenAI key only.
- Extension AI parsing calls the OpenAI Responses API with `store: false` and strict Structured Outputs.
- Extension imports use bearer token auth, not ambient website cookies.
- Extension ids must match `^[a-p]{32}$` and must be present in server config `EXTENSION_ALLOWED_IDS`.
- Extension token scope is `facebook_listing_import`.
- Extension import request body cap is 64 KB.
- Manifest `externally_connectable.matches` uses `http://localhost/*` for dev because Chrome match patterns do not include ports.
- App-side same-origin checks still enforce `http://localhost:3333` through `BETTER_AUTH_URL`.
- `sourceGroupUrl` and `sourcePostUrl` must be HTTPS Facebook URLs for production captures.
- `capturedText` is untrusted user-imported content and must be escaped by UI rendering.
- `HousingDetails.notes` is part of the shared contract and maps into listing candidate caveats.
- Save retries must be idempotent by `(workspaceId, idempotencyKey)`.
- Keep `sample-map.json` untracked and untouched.

---

## File Structure

- Modify `lib/domain/types.ts`: shared `HousingDetails`, extension connection, Facebook import, and revoke response types.
- Modify `lib/domain/schemas.ts`: shared Zod schemas for `HousingDetails`, extension ids, connection requests, token revoke responses, and Facebook import requests/responses.
- Modify `lib/db/schema.ts`: move `HousingDetails` import from domain, add token/idempotency tables, add `notes` support, and add a unique index for Facebook captures by post URL.
- Generate `drizzle/*` migration files from schema changes.
- Create `lib/server/extension/connections.ts`: allowed extension id parsing, token generation/hash/validation/revocation.
- Create `lib/server/imports/facebook-listings.ts`: Facebook import transaction, idempotency handling, listing lead normalization.
- Modify `lib/server/workspace-state.ts`: reset deletes extension token/import attempt rows.
- Modify `lib/server/workspaces.ts`: workspace/account delete cascades through new tables by FK.
- Create `lib/server/listing-leads/serialize.ts`: shared listing lead serializer used by current listing storage and Facebook imports.
- Create `app/extension/connect/page.tsx`: signed-in connect page.
- Create `app/api/extension/connections/route.ts`: mint extension import token.
- Create `app/api/extension/connections/current/route.ts`: website-side disconnect.
- Create `app/api/extension/connections/token/route.ts`: extension-token disconnect.
- Create `app/api/imports/facebook-listings/route.ts`: extension-authenticated import.
- Modify `.env.example`: add `EXTENSION_ALLOWED_IDS`.
- Modify `README.md`: add local extension setup.
- Create `extension/manifest.json`: MV3 manifest.
- Create `extension/background.js`: token storage, app connection, import, disconnect, review-window orchestration.
- Create `extension/config.js`: dev app origin and extension constants.
- Create `extension/storage.js`: extension storage wrapper and allowlist state.
- Create `extension/group-context.js`: Facebook group URL/context parsing.
- Create `extension/capture.js`: post capture serialization.
- Create `extension/content-script.js`: DOM observer and save button injection.
- Create `extension/content-style.css`: injected save button styles.
- Create `extension/popup.html`, `extension/popup.js`, `extension/popup.css`: connection and allowlist UI.
- Create `extension/review.html`, `extension/review.js`, `extension/review.css`: review/edit/save UI.
- Create `extension/openai-parser.js`: optional HousingDetails parser using user BYO OpenAI key.
- Create `tests/unit/extension-openai-parser.test.ts`: parser request and response handling tests.
- Create `tests/unit/facebook-extension-domain.test.ts`: domain schema and normalization tests.
- Create `tests/unit/extension-connections.test.ts`: token service unit tests.
- Create `tests/unit/facebook-listing-imports.test.ts`: import service unit tests.
- Create `tests/routes/extension-connections-route.test.ts`: connection route tests.
- Create `tests/routes/facebook-listings-import-route.test.ts`: import route tests.
- Create `tests/unit/extension-group-context.test.ts`: extension group parser tests.
- Create `tests/unit/extension-capture.test.ts`: extension capture serializer tests.
- Create `tests/e2e/extension-fixtures/facebook-group-post.html`: fixture page for manual and automated checks.

---

### Task 1: Shared Domain Contracts

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/facebook-extension-domain.test.ts`

**Interfaces:**
- Consumes: existing `ListingLead`, `listingLeadSchema`, and text length constants in `lib/domain/schemas.ts`.
- Produces:
  - `HousingDetails`
  - `ExtensionScope`
  - `CreateExtensionConnectionRequest`
  - `CreateExtensionConnectionResponse`
  - `RevokeExtensionTokenResponse`
  - `FacebookListingImportRequest`
  - `FacebookListingImportResponse`
  - `extensionIdSchema`
  - `housingDetailsSchema`
  - `facebookListingImportRequestSchema`

- [ ] **Step 1: Write failing domain schema tests**

Add `tests/unit/facebook-extension-domain.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  createExtensionConnectionRequestSchema,
  facebookListingImportRequestSchema,
  housingDetailsSchema,
} from "@/lib/domain/schemas";

describe("Facebook extension domain schemas", () => {
  test("accepts a complete housing details object with notes", () => {
    expect(
      housingDetailsSchema.parse({
        listingType: "private_room",
        tenancyType: "sublet",
        priceMonthly: 1800,
        bedrooms: 2,
        bathroom: "shared",
        roommateCount: 2,
        locationText: "Hayes Valley",
        neighborhoodGuess: "Hayes Valley",
        availabilityStart: "2026-07-15",
        availabilityEnd: "2026-10-15",
        dateFlexibility: "flexible",
        durationText: "3 months",
        furnished: true,
        pets: "unknown",
        notes: ["Prefers someone quiet", "Utilities not confirmed"],
      }),
    ).toMatchObject({
      listingType: "private_room",
      notes: ["Prefers someone quiet", "Utilities not confirmed"],
    });
  });

  test("rejects invalid Chrome extension ids", () => {
    expect(() =>
      createExtensionConnectionRequestSchema.parse({
        extensionId: "abcdefghijklmnopqrstuvwxyzzzzzzz",
      }),
    ).toThrow();
  });

  test("accepts Facebook import requests with idempotency keys", () => {
    expect(
      facebookListingImportRequestSchema.parse({
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        sourceSurface: "groupFeed",
        sourceGroupId: "12345",
        sourceGroupName: "SF Housing",
        sourceGroupUrl: "https://www.facebook.com/groups/12345",
        sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
        capturedText: "Room in Hayes Valley, $1800, available July 15.",
        capturedAt: "2026-06-30T02:00:00.000Z",
        parsedDraft: null,
        reviewedDetails: null,
        incompleteFlags: ["missing_bathroom", "missing_roommate_count"],
      }),
    ).toMatchObject({
      sourceSurface: "groupFeed",
      incompleteFlags: ["missing_bathroom", "missing_roommate_count"],
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test -- tests/unit/facebook-extension-domain.test.ts`

Expected: FAIL because `housingDetailsSchema`, `createExtensionConnectionRequestSchema`, and `facebookListingImportRequestSchema` do not exist.

- [ ] **Step 3: Add shared domain types**

In `lib/domain/types.ts`, add after `GeocodeCacheEntry`:

```ts
export type HousingDetails = {
  listingType: "full_apartment" | "private_room" | "shared_room" | "roommate_search" | "unknown";
  tenancyType: "new_lease" | "lease_takeover" | "sublet" | "month_to_month" | "unknown";
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
  notes: string[];
};

export type ExtensionScope = "facebook_listing_import";

export type CreateExtensionConnectionRequest = {
  extensionId: string;
};

export type CreateExtensionConnectionResponse =
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

export type RevokeExtensionTokenResponse =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "token_expired" | "invalid_request" };

export type FacebookListingImportRequest = {
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

export type FacebookListingImportResponse =
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

- [ ] **Step 4: Add shared domain schemas**

In `lib/domain/schemas.ts`, import the new types and add after `geocodeCacheEntrySchema`:

```ts
export const extensionIdSchema = z.string().regex(/^[a-p]{32}$/);

export const housingDetailsSchema: z.ZodType<HousingDetails> = z
  .object({
    listingType: z.enum([
      "full_apartment",
      "private_room",
      "shared_room",
      "roommate_search",
      "unknown",
    ]),
    tenancyType: z.enum(["new_lease", "lease_takeover", "sublet", "month_to_month", "unknown"]),
    priceMonthly: z.number().int().positive().nullable(),
    bedrooms: z.union([z.number().int().nonnegative(), z.literal("studio")]).nullable(),
    bathroom: z.enum(["private", "shared", "unknown"]),
    roommateCount: z.number().int().nonnegative().nullable(),
    locationText: textSchema.nullable(),
    neighborhoodGuess: nameSchema,
    availabilityStart: textSchema.nullable(),
    availabilityEnd: textSchema.nullable(),
    dateFlexibility: z.enum(["fixed", "flexible", "unknown"]),
    durationText: textSchema.nullable(),
    furnished: z.boolean().nullable(),
    pets: z.enum(["allowed", "not_allowed", "unknown"]),
    notes: notesSchema,
  })
  .strict();

export const createExtensionConnectionRequestSchema: z.ZodType<CreateExtensionConnectionRequest> = z
  .object({
    extensionId: extensionIdSchema,
  })
  .strict();

export const facebookListingImportRequestSchema: z.ZodType<FacebookListingImportRequest> = z
  .object({
    idempotencyKey: z.string().uuid(),
    sourceSurface: z.enum(["homeFeed", "groupFeed", "postPermalink"]),
    sourceGroupId: requiredTextSchema,
    sourceGroupName: nameSchema,
    sourceGroupUrl: urlSchema,
    sourcePostUrl: urlSchema,
    capturedText: requiredLongTextSchema,
    capturedAt: z.string().datetime(),
    parsedDraft: housingDetailsSchema.nullable(),
    reviewedDetails: housingDetailsSchema.nullable(),
    incompleteFlags: z.array(textSchema).max(MAX_CAVEATS),
  })
  .strict();
```

Update the top type import list in `lib/domain/schemas.ts` to include:

```ts
CreateExtensionConnectionRequest,
FacebookListingImportRequest,
HousingDetails,
```

- [ ] **Step 5: Run the domain tests and typecheck**

Run:

```bash
npm run test -- tests/unit/facebook-extension-domain.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/types.ts lib/domain/schemas.ts tests/unit/facebook-extension-domain.test.ts
git commit -m "Add Facebook extension domain contracts"
```

---

### Task 2: Database Schema And Migration

**Files:**
- Modify: `lib/db/schema.ts`
- Generate: `drizzle/*.sql`
- Generate/modify: `drizzle/meta/*.json`
- Test: `tests/unit/workspace-state.test.ts`

**Interfaces:**
- Consumes: `HousingDetails` and `ExtensionScope` from `lib/domain/types.ts`.
- Produces:
  - `extensionConnectionTokens`
  - `facebookListingImportAttempts`
  - `facebookListingCaptures` unique `(workspaceId, sourcePostUrl)`

- [ ] **Step 1: Write failing reset cleanup test**

In `tests/unit/workspace-state.test.ts`, import the new tables and extend the reset cleanup test:

```ts
import {
  extensionConnectionTokens,
  facebookListingImportAttempts,
  facebookListingCaptures,
  // existing imports stay
} from "@/lib/db/schema";
```

Add these expectations to the existing `reset deletes workspace product rows and leaves other workspaces untouched` test:

```ts
expect(getCurrentDb().state.extensionConnectionTokens.map((row) => row.workspaceId)).toEqual([
  "workspace-2",
]);
expect(getCurrentDb().state.facebookListingImportAttempts.map((row) => row.workspaceId)).toEqual([
  "workspace-2",
]);
```

Add matching mock rows to `createWorkspaceStateDbMock()` state:

```ts
extensionConnectionTokens: [
  { id: "token-1", workspaceId: "workspace-1" },
  { id: "token-2", workspaceId: "workspace-2" },
],
facebookListingImportAttempts: [
  { id: "attempt-1", workspaceId: "workspace-1" },
  { id: "attempt-2", workspaceId: "workspace-2" },
],
```

Extend the mock table routing in that test helper so deletes for the two new tables mutate those arrays.

- [ ] **Step 2: Run the reset test and verify it fails**

Run: `npm run test -- tests/unit/workspace-state.test.ts`

Expected: FAIL because `extensionConnectionTokens` and `facebookListingImportAttempts` are not exported yet.

- [ ] **Step 3: Modify DB schema**

In `lib/db/schema.ts`, add `HousingDetails`, `ExtensionScope`, and `FacebookListingImportResponse` to the domain type import list. Remove the local `export type HousingDetails = ...` block.

Update `facebookListingCaptures` JSON types to use the imported shared type and add the unique index:

```ts
export const facebookListingCaptures = pgTable(
  "facebook_listing_capture",
  {
    // existing columns stay
    parsedDraft: jsonb("parsed_draft").$type<HousingDetails>(),
    reviewedDetails: jsonb("reviewed_details").$type<HousingDetails>(),
    // existing columns stay
  },
  (table) => [
    index("facebook_capture_workspace_created_idx").on(table.workspaceId, table.createdAt),
    unique("facebook_capture_workspace_post_url_unique").on(table.workspaceId, table.sourcePostUrl),
  ],
);
```

Add after `facebookListingCaptures`:

```ts
export const extensionConnectionTokens = pgTable(
  "extension_connection_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    extensionId: text("extension_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    scope: text("scope", { enum: ["facebook_listing_import"] }).$type<ExtensionScope>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("extension_connection_token_hash_unique").on(table.tokenHash),
    index("extension_connection_workspace_extension_idx").on(table.workspaceId, table.extensionId),
  ],
);

export const facebookListingImportAttempts = pgTable(
  "facebook_listing_import_attempt",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    captureId: text("capture_id")
      .notNull()
      .references(() => facebookListingCaptures.id, { onDelete: "cascade" }),
    listingLeadId: text("listing_lead_id")
      .notNull()
      .references(() => listingLeads.id, { onDelete: "cascade" }),
    successfulResponse: jsonb("successful_response")
      .$type<{
        captureId: string;
        leadCanonicalUrl: string;
        listingLedgerRevision: string;
      }>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("facebook_import_attempt_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
  ],
);
```

- [ ] **Step 4: Update reset cleanup**

In `lib/server/workspace-state.ts`, import the new tables and delete rows in dependency order before deleting captures/leads:

```ts
extensionConnectionTokens,
facebookListingImportAttempts,
```

Inside `deleteWorkspaceProductRows()`:

```ts
await database
  .delete(facebookListingImportAttempts)
  .where(eq(facebookListingImportAttempts.workspaceId, workspaceId));
await database
  .delete(extensionConnectionTokens)
  .where(eq(extensionConnectionTokens.workspaceId, workspaceId));
await database
  .delete(facebookListingCaptures)
  .where(eq(facebookListingCaptures.workspaceId, workspaceId));
```

- [ ] **Step 5: Generate the Drizzle migration**

Run: `npm run db:generate`

Expected: a new migration SQL file and updated `drizzle/meta` snapshot.

Review the SQL and confirm it includes:

```sql
CREATE TABLE "extension_connection_token"
CREATE TABLE "facebook_listing_import_attempt"
CREATE UNIQUE INDEX "facebook_capture_workspace_post_url_unique"
CREATE UNIQUE INDEX "facebook_import_attempt_workspace_idempotency_unique"
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm run test -- tests/unit/workspace-state.test.ts tests/unit/facebook-extension-domain.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/server/workspace-state.ts tests/unit/workspace-state.test.ts drizzle
git commit -m "Add extension import database tables"
```

---

### Task 3: Extension Token Service

**Files:**
- Create: `lib/server/extension/connections.ts`
- Test: `tests/unit/extension-connections.test.ts`

**Interfaces:**
- Consumes: `extensionConnectionTokens`, `users`, `workspaces`.
- Produces:
  - `isAllowedExtensionId(extensionId: string): boolean`
  - `createExtensionConnection(input): Promise<CreateExtensionConnectionResponse>`
  - `validateExtensionBearer(input): Promise<ExtensionBearerValidation>`
  - `revokeExtensionBearer(input): Promise<RevokeExtensionTokenResponse>`
  - `revokeWorkspaceExtensionConnections(input): Promise<void>`

- [ ] **Step 1: Write failing token service tests**

Create `tests/unit/extension-connections.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  createToken: vi.fn(),
  validateToken: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => dbMock,
}));

import {
  createExtensionConnection,
  isAllowedExtensionId,
  revokeExtensionBearer,
  validateExtensionBearer,
} from "@/lib/server/extension/connections";

describe("extension connections", () => {
  beforeEach(() => {
    vi.stubEnv("EXTENSION_ALLOWED_IDS", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    dbMock.createToken.mockReset();
    dbMock.validateToken.mockReset();
    dbMock.revokeToken.mockReset();
  });

  test("allows only configured Chrome extension ids", () => {
    expect(isAllowedExtensionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isAllowedExtensionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
    expect(isAllowedExtensionId("not-an-id")).toBe(false);
  });

  test("creates a scoped token for the workspace", async () => {
    dbMock.createToken.mockResolvedValueOnce({
      token: "plain-token",
      expiresAt: "2026-07-30T02:00:00.000Z",
    });

    const result = await createExtensionConnection({
      userId: "user-1",
      userEmail: "tracy@example.com",
      workspace: { id: "workspace-1", name: "Apartment hunt" },
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      now: new Date("2026-06-30T02:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      token: "plain-token",
      expiresAt: "2026-07-30T02:00:00.000Z",
      account: { email: "tracy@example.com" },
      workspace: { id: "workspace-1", name: "Apartment hunt" },
    });
  });

  test("rejects token validation when extension id does not match", async () => {
    dbMock.validateToken.mockResolvedValueOnce({ ok: false, error: "unauthorized" });

    await expect(
      validateExtensionBearer({
        token: "plain-token",
        extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, error: "unauthorized" });
  });

  test("revokes the active bearer token", async () => {
    dbMock.revokeToken.mockResolvedValueOnce({ ok: true });

    await expect(
      revokeExtensionBearer({
        token: "plain-token",
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        now: new Date("2026-06-30T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/unit/extension-connections.test.ts`

Expected: FAIL because `lib/server/extension/connections.ts` does not exist.

- [ ] **Step 3: Implement allowed id parsing and token hashing**

Create `lib/server/extension/connections.ts`:

```ts
import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import { extensionConnectionTokens } from "@/lib/db/schema";
import type {
  CreateExtensionConnectionResponse,
  RevokeExtensionTokenResponse,
} from "@/lib/domain/types";

const extensionIdPattern = /^[a-p]{32}$/;
const tokenByteLength = 32;
const tokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export type ExtensionBearerValidation =
  | {
      ok: true;
      userId: string;
      workspaceId: string;
      extensionId: string;
    }
  | { ok: false; error: "unauthorized" | "token_expired" };

export function isAllowedExtensionId(extensionId: string) {
  return extensionIdPattern.test(extensionId) && readAllowedExtensionIds().includes(extensionId);
}

export async function createExtensionConnection(input: {
  userId: string;
  userEmail: string;
  workspace: { id: string; name: string };
  extensionId: string;
  now?: Date;
}): Promise<CreateExtensionConnectionResponse> {
  if (!isAllowedExtensionId(input.extensionId)) {
    return { ok: false, error: "extension_not_allowed" };
  }

  const now = input.now ?? new Date();
  const token = randomBytes(tokenByteLength).toString("base64url");
  const expiresAt = new Date(now.getTime() + tokenLifetimeMs);

  await requireDb().insert(extensionConnectionTokens).values({
    id: `extension-token-${randomUUID()}`,
    userId: input.userId,
    workspaceId: input.workspace.id,
    extensionId: input.extensionId,
    tokenHash: hashToken(token),
    scope: "facebook_listing_import",
    expiresAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    token,
    expiresAt: expiresAt.toISOString(),
    account: { email: input.userEmail },
    workspace: input.workspace,
  };
}

export async function validateExtensionBearer(input: {
  token: string;
  extensionId: string;
  now?: Date;
}): Promise<ExtensionBearerValidation> {
  if (!isAllowedExtensionId(input.extensionId)) {
    return { ok: false, error: "unauthorized" };
  }

  const row = await requireDb().query.extensionConnectionTokens.findFirst({
    where: and(
      eq(extensionConnectionTokens.tokenHash, hashToken(input.token)),
      eq(extensionConnectionTokens.extensionId, input.extensionId),
      eq(extensionConnectionTokens.scope, "facebook_listing_import"),
      isNull(extensionConnectionTokens.revokedAt),
    ),
  });

  if (!row) {
    return { ok: false, error: "unauthorized" };
  }

  if (row.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return { ok: false, error: "token_expired" };
  }

  return {
    ok: true,
    userId: row.userId,
    workspaceId: row.workspaceId,
    extensionId: row.extensionId,
  };
}

export async function revokeExtensionBearer(input: {
  token: string;
  extensionId: string;
  now?: Date;
}): Promise<RevokeExtensionTokenResponse> {
  const validation = await validateExtensionBearer(input);

  if (!validation.ok) {
    return validation.error === "token_expired"
      ? { ok: false, error: "token_expired" }
      : { ok: false, error: "unauthorized" };
  }

  await requireDb()
    .update(extensionConnectionTokens)
    .set({ revokedAt: input.now ?? new Date(), updatedAt: input.now ?? new Date() })
    .where(
      and(
        eq(extensionConnectionTokens.tokenHash, hashToken(input.token)),
        eq(extensionConnectionTokens.extensionId, input.extensionId),
      ),
    );

  return { ok: true };
}

export async function revokeWorkspaceExtensionConnections(input: {
  userId: string;
  workspaceId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  await requireDb()
    .update(extensionConnectionTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(extensionConnectionTokens.userId, input.userId),
        eq(extensionConnectionTokens.workspaceId, input.workspaceId),
        isNull(extensionConnectionTokens.revokedAt),
      ),
    );
}

function readAllowedExtensionIds() {
  return (process.env.EXTENSION_ALLOWED_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => extensionIdPattern.test(value));
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: Extend tests with Drizzle-backed assertions**

Extend `tests/unit/extension-connections.test.ts` with the established query-chain mock style from `tests/unit/listing-leads-db.test.ts` so the tests assert:

```ts
expect(getCurrentDb().state.tokens[0]).toMatchObject({
  userId: "user-1",
  workspaceId: "workspace-1",
  extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  scope: "facebook_listing_import",
});
expect(getCurrentDb().state.tokens[0].tokenHash).not.toBe("plain-token");
```

Also assert expired and revoked rows are rejected:

```ts
getCurrentDb().state.tokens[0].expiresAt = new Date("2026-06-29T02:00:00.000Z");
await expect(validateExtensionBearer({ token, extensionId, now })).resolves.toEqual({
  ok: false,
  error: "token_expired",
});
```

- [ ] **Step 5: Run token service tests**

Run:

```bash
npm run test -- tests/unit/extension-connections.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/server/extension/connections.ts tests/unit/extension-connections.test.ts
git commit -m "Add extension connection tokens"
```

---

### Task 4: Facebook Listing Import Service

**Files:**
- Create: `lib/server/imports/facebook-listings.ts`
- Test: `tests/unit/facebook-listing-imports.test.ts`

**Interfaces:**
- Consumes:
  - `FacebookListingImportRequest`
  - `ListingLead`
  - `validateExtensionBearer()` result from Task 3
  - Drizzle tables from Task 2
- Produces:
  - `normalizeFacebookListingCandidate(input): ListingCandidate`
  - `importFacebookListing(input): Promise<FacebookListingImportResponse>`

- [ ] **Step 1: Write failing normalization tests**

Create `tests/unit/facebook-listing-imports.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type { FacebookListingImportRequest } from "@/lib/domain/types";
import { normalizeFacebookListingCandidate } from "@/lib/server/imports/facebook-listings";

describe("Facebook listing imports", () => {
  test("normalizes reviewed private-room details into a saved listing candidate", () => {
    const candidate = normalizeFacebookListingCandidate(createImportRequest());

    expect(candidate).toMatchObject({
      id: "facebook-67890",
      title: "$1,800 private room in Hayes Valley",
      url: "https://www.facebook.com/groups/12345/posts/67890",
      sourceDomain: "facebook.com",
      neighborhoodGuess: "Hayes Valley",
      locationText: "Hayes Valley",
      priceMonthly: 1800,
      beds: "unknown",
      shortTermSignal: true,
      furnishedSignal: true,
      caveats: expect.arrayContaining(["Utilities not confirmed"]),
    });
  });

  test("normalizes incomplete captures without blocking save", () => {
    const candidate = normalizeFacebookListingCandidate({
      ...createImportRequest(),
      reviewedDetails: null,
      incompleteFlags: ["missing_price", "missing_location"],
    });

    expect(candidate).toMatchObject({
      title: "Facebook listing",
      priceMonthly: null,
      locationConfidence: "low",
      markerPrecision: "none",
      caveats: expect.arrayContaining(["missing_price", "missing_location"]),
    });
  });
});

function createImportRequest(): FacebookListingImportRequest {
  return {
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    sourceSurface: "groupFeed",
    sourceGroupId: "12345",
    sourceGroupName: "SF Housing",
    sourceGroupUrl: "https://www.facebook.com/groups/12345",
    sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
    capturedText: "Room in Hayes Valley, $1800, available July 15.",
    capturedAt: "2026-06-30T02:00:00.000Z",
    parsedDraft: null,
    reviewedDetails: {
      listingType: "private_room",
      tenancyType: "sublet",
      priceMonthly: 1800,
      bedrooms: 2,
      bathroom: "shared",
      roommateCount: 2,
      locationText: "Hayes Valley",
      neighborhoodGuess: "Hayes Valley",
      availabilityStart: "2026-07-15",
      availabilityEnd: "2026-10-15",
      dateFlexibility: "flexible",
      durationText: "3 months",
      furnished: true,
      pets: "unknown",
      notes: ["Utilities not confirmed"],
    },
    incompleteFlags: [],
  };
}
```

- [ ] **Step 2: Run normalization tests and verify failure**

Run: `npm run test -- tests/unit/facebook-listing-imports.test.ts`

Expected: FAIL because `lib/server/imports/facebook-listings.ts` does not exist.

- [ ] **Step 3: Implement normalization**

Create `lib/server/imports/facebook-listings.ts`:

```ts
import "server-only";

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";

import { requireDb } from "@/lib/db/client";
import {
  facebookListingCaptures,
  facebookListingImportAttempts,
  listingLeads,
  workspaces,
} from "@/lib/db/schema";
import { createRevision } from "@/lib/db/workspace-revisions";
import type {
  FacebookListingImportRequest,
  FacebookListingImportResponse,
  HousingDetails,
  ListingCandidate,
  ListingLead,
} from "@/lib/domain/types";

export function normalizeFacebookListingCandidate(
  request: FacebookListingImportRequest,
): ListingCandidate {
  const details = request.reviewedDetails ?? request.parsedDraft;
  const price = details?.priceMonthly ?? null;
  const location = details?.locationText ?? null;
  const neighborhood = details?.neighborhoodGuess || "Unknown";
  const title = buildFacebookTitle(details);
  const caveats = [
    ...(details?.notes ?? []),
    ...request.incompleteFlags,
    ...(request.reviewedDetails ? [] : ["Saved from an incomplete Facebook review."]),
  ];

  return {
    id: `facebook-${stableSuffix(request.sourcePostUrl)}`,
    title,
    url: request.sourcePostUrl,
    sourceDomain: "facebook.com",
    neighborhoodGuess: neighborhood,
    locationText: location,
    geocodeQuery: location,
    locationConfidence: location ? "medium" : "low",
    coordinates: null,
    geocodeStatus: "not_attempted",
    markerPrecision: "none",
    priceMonthly: price,
    beds: mapBedrooms(details),
    shortTermSignal: details
      ? details.tenancyType === "sublet" ||
        details.tenancyType === "month_to_month" ||
        Boolean(details.availabilityEnd)
      : false,
    furnishedSignal: details?.furnished === true,
    fitScore: 3,
    whyItFits: "Saved manually from an allowlisted Facebook housing group.",
    citations: [
      {
        url: request.sourcePostUrl,
        title: request.sourceGroupName,
        sourceDomain: "facebook.com",
      },
    ],
    caveats,
  };
}

function buildFacebookTitle(details: HousingDetails | null | undefined) {
  if (!details) {
    return "Facebook listing";
  }

  const price = details.priceMonthly ? `$${details.priceMonthly.toLocaleString()}` : null;
  const type = details.listingType === "private_room" ? "private room" : details.listingType;
  const location = details.neighborhoodGuess && details.neighborhoodGuess !== "Unknown"
    ? `in ${details.neighborhoodGuess}`
    : null;

  return [price, type === "unknown" ? "Facebook listing" : type.replaceAll("_", " "), location]
    .filter(Boolean)
    .join(" ");
}

function mapBedrooms(details: HousingDetails | null | undefined): ListingCandidate["beds"] {
  if (!details) {
    return "unknown";
  }

  if (details.bedrooms === "studio") {
    return "studio";
  }

  return details.bedrooms === 1 && details.listingType === "full_apartment" ? "1br" : "unknown";
}

function stableSuffix(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
```

- [ ] **Step 4: Run normalization tests**

Run: `npm run test -- tests/unit/facebook-listing-imports.test.ts`

Expected: PASS for normalization tests.

- [ ] **Step 5: Add import transaction tests**

Extend `tests/unit/facebook-listing-imports.test.ts` with transaction tests using the Drizzle mock style from `tests/unit/listing-leads-db.test.ts`:

```ts
test("imports a new Facebook capture and advances the listing ledger", async () => {
  createRevisionMock.mockReturnValueOnce("ledger-2");

  const result = await importFacebookListing({
    workspaceId: "workspace-1",
    request: createImportRequest(),
    now: new Date("2026-06-30T02:00:00.000Z"),
  });

  expect(result.ok).toBe(true);
  expect(result.ok && result.lead.status).toBe("saved");
  expect(result.ok && result.listingLedgerRevision).toBe("ledger-2");
  expect(getCurrentDb().state.facebookListingCaptures).toHaveLength(1);
  expect(getCurrentDb().state.facebookListingImportAttempts).toHaveLength(1);
});

test("replays the same idempotency key and payload without mutating seen count", async () => {
  createRevisionMock.mockReturnValueOnce("ledger-2");
  const first = await importFacebookListing({
    workspaceId: "workspace-1",
    request: createImportRequest(),
    now: new Date("2026-06-30T02:00:00.000Z"),
  });
  const seenCount = getCurrentDb().state.listingLeads[0].seenCount;

  const replay = await importFacebookListing({
    workspaceId: "workspace-1",
    request: createImportRequest(),
    now: new Date("2026-06-30T02:01:00.000Z"),
  });

  expect(replay).toEqual(first);
  expect(getCurrentDb().state.listingLeads[0].seenCount).toBe(seenCount);
});

test("rejects same idempotency key with a different payload", async () => {
  createRevisionMock.mockReturnValueOnce("ledger-2");
  await importFacebookListing({
    workspaceId: "workspace-1",
    request: createImportRequest(),
    now: new Date("2026-06-30T02:00:00.000Z"),
  });

  const result = await importFacebookListing({
    workspaceId: "workspace-1",
    request: { ...createImportRequest(), capturedText: "Different body" },
    now: new Date("2026-06-30T02:01:00.000Z"),
  });

  expect(result).toEqual({ ok: false, error: "idempotency_conflict" });
});
```

- [ ] **Step 6: Implement import transaction**

Add `importFacebookListing()` to `lib/server/imports/facebook-listings.ts`:

```ts
export async function importFacebookListing(input: {
  workspaceId: string;
  request: FacebookListingImportRequest;
  now?: Date;
}): Promise<FacebookListingImportResponse> {
  const now = input.now ?? new Date();
  const payloadHash = hashPayload(input.request);
  const database = requireDb();

  return database.transaction(async (tx) => {
    const existingAttempt = await tx.query.facebookListingImportAttempts.findFirst({
      where: and(
        eq(facebookListingImportAttempts.workspaceId, input.workspaceId),
        eq(facebookListingImportAttempts.idempotencyKey, input.request.idempotencyKey),
      ),
    });

    if (existingAttempt) {
      if (existingAttempt.payloadHash !== payloadHash) {
        return { ok: false, error: "idempotency_conflict" };
      }

      const lead = await tx.query.listingLeads.findFirst({
        where: eq(listingLeads.id, existingAttempt.listingLeadId),
      });

      if (!lead) {
        return { ok: false, error: "import_failed" };
      }

      return {
        ok: true,
        captureId: existingAttempt.successfulResponse.captureId,
        lead: serializeListingLead(lead),
        listingLedgerRevision: existingAttempt.successfulResponse.listingLedgerRevision,
      };
    }

    const [workspace] = await tx
      .update(workspaces)
      .set({ listingLedgerRevision: createRevision("ledger"), updatedAt: now })
      .where(eq(workspaces.id, input.workspaceId))
      .returning();

    if (!workspace) {
      return { ok: false, error: "import_failed" };
    }

    const candidate = normalizeFacebookListingCandidate(input.request);
    const existingLead = await tx.query.listingLeads.findFirst({
      where: and(
        eq(listingLeads.workspaceId, input.workspaceId),
        eq(listingLeads.canonicalUrl, input.request.sourcePostUrl),
      ),
    });

    const lead = existingLead
      ? await updateExistingLead(tx, existingLead, candidate, now)
      : await insertNewLead(tx, input.workspaceId, input.request.sourcePostUrl, candidate, now);

    const capture = await upsertCapture(tx, input.workspaceId, input.request, lead.id, now);

    await tx.insert(facebookListingImportAttempts).values({
      id: `facebook-import-attempt-${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      idempotencyKey: input.request.idempotencyKey,
      payloadHash,
      captureId: capture.id,
      listingLeadId: lead.id,
      successfulResponse: {
        captureId: capture.id,
        leadCanonicalUrl: lead.canonicalUrl,
        listingLedgerRevision: workspace.listingLedgerRevision,
      },
      createdAt: now,
    });

    return {
      ok: true,
      captureId: capture.id,
      lead: serializeListingLead(lead),
      listingLedgerRevision: workspace.listingLedgerRevision,
    };
  });
}
```

Implement the helpers referenced above in the same file:

```ts
function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
```

Create `lib/server/listing-leads/serialize.ts`:

```ts
import type { ListingLead } from "@/lib/domain/types";

export function serializeListingLead(lead: {
  canonicalUrl: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  lastSearchQuery: string;
  seenCount: number;
  status: ListingLead["status"];
  candidate: ListingLead["candidate"];
}): ListingLead {
  return {
    canonicalUrl: lead.canonicalUrl,
    firstSeenAt: toIsoString(lead.firstSeenAt),
    lastSeenAt: toIsoString(lead.lastSeenAt),
    lastSearchQuery: lead.lastSearchQuery,
    seenCount: lead.seenCount,
    status: lead.status,
    candidate: {
      ...lead.candidate,
      url: lead.canonicalUrl,
    },
  };
}

function toIsoString(value: Date | string) {
  return typeof value === "string" ? value : value.toISOString();
}
```

Update `lib/server/listing-leads-db.ts` to import this helper and remove its local `serializeListingLead()` and `toIsoString()` definitions. Use the shared helper from `lib/server/imports/facebook-listings.ts`.

- [ ] **Step 7: Run import service tests**

Run:

```bash
npm run test -- tests/unit/facebook-listing-imports.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/server/imports/facebook-listings.ts tests/unit/facebook-listing-imports.test.ts lib/server/listing-leads-db.ts lib/server/listing-leads
git commit -m "Add Facebook listing import service"
```

---

### Task 5: App Routes For Extension Connection And Imports

**Files:**
- Modify: `lib/server/auth/session.ts`
- Create: `app/extension/connect/page.tsx`
- Create: `app/api/extension/connections/route.ts`
- Create: `app/api/extension/connections/current/route.ts`
- Create: `app/api/extension/connections/token/route.ts`
- Create: `app/api/imports/facebook-listings/route.ts`
- Test: `tests/routes/extension-connections-route.test.ts`
- Test: `tests/routes/facebook-listings-import-route.test.ts`

**Interfaces:**
- Consumes:
  - `createExtensionConnection()`
  - `revokeWorkspaceExtensionConnections()`
  - `revokeExtensionBearer()`
  - `validateExtensionBearer()`
  - `importFacebookListing()`
- Produces HTTP routes consumed by the extension.

- [ ] **Step 1: Write failing connection route tests**

Create `tests/routes/extension-connections-route.test.ts` with cases:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
}));
const connectionMocks = vi.hoisted(() => ({
  createExtensionConnection: vi.fn(),
  revokeWorkspaceExtensionConnections: vi.fn(),
  revokeExtensionBearer: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", () => {
  class MockUnauthorizedError extends Error {}
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireCurrentUser: async () => {
      if (!sessionMock.user) throw new MockUnauthorizedError();
      return sessionMock.user;
    },
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async () => ({
    workspace: { id: "workspace-1", name: "Apartment hunt" },
  }),
}));

vi.mock("@/lib/server/extension/connections", () => connectionMocks);

import { POST } from "@/app/api/extension/connections/route";

describe("extension connection route", () => {
  beforeEach(() => {
    sessionMock.user = null;
    connectionMocks.createExtensionConnection.mockReset();
    connectionMocks.createExtensionConnection.mockResolvedValue({
      ok: true,
      token: "token-1",
      expiresAt: "2026-07-30T02:00:00.000Z",
      account: { email: "tracy@example.com" },
      workspace: { id: "workspace-1", name: "Apartment hunt" },
    });
  });

  test("rejects signed-out users", async () => {
    const response = await POST(createConnectionRequest({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
    expect(response.status).toBe(401);
  });

  test("rejects cross-site requests", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };
    const response = await POST(
      createConnectionRequest(
        { extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      ),
    );
    expect(response.status).toBe(403);
  });

  test("returns token for signed-in allowed extension", async () => {
    sessionMock.user = { id: "user-1", email: "tracy@example.com" };
    const response = await POST(createConnectionRequest({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

function createConnectionRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/extension/connections", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3333",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Run connection route tests and verify failure**

Run: `npm run test -- tests/routes/extension-connections-route.test.ts`

Expected: FAIL because routes and `requireCurrentUser()` do not exist.

- [ ] **Step 3: Add current-user helper**

In `lib/server/auth/session.ts`, add:

```ts
export async function getCurrentUser(request?: Request) {
  const userId = await getCurrentUserId(request);

  if (!userId) {
    return null;
  }

  if (!process.env.DATABASE_URL) {
    return { id: userId, email: "dev@example.local" };
  }

  const { getAuth } = await import("@/lib/server/auth/config");
  const session = await getAuth().api.getSession({
    headers: request ? request.headers : await headers(),
  });

  return session?.user ? { id: session.user.id, email: session.user.email } : null;
}

export async function requireCurrentUser(request?: Request) {
  const user = await getCurrentUser(request);

  if (!user) {
    throw new UnauthorizedError();
  }

  return user;
}
```

Keep `requireCurrentUserId()` unchanged for existing callers.

- [ ] **Step 4: Implement connection routes**

Create `app/api/extension/connections/route.ts`:

```ts
import { z } from "zod";

import { createExtensionConnectionRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUser } from "@/lib/server/auth/session";
import { createExtensionConnection } from "@/lib/server/extension/connections";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_EXTENSION_CONNECTION_REQUEST_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const user = await requireCurrentUser(request);
    const body = createExtensionConnectionRequestSchema.parse(
      await readJsonRequestBody(request, MAX_EXTENSION_CONNECTION_REQUEST_BYTES),
    );
    const { workspace } = await getOrCreateDefaultWorkspace(user.id);

    const result = await createExtensionConnection({
      userId: user.id,
      userEmail: user.email,
      workspace: { id: workspace.id, name: workspace.name },
      extensionId: body.extensionId,
    });

    return Response.json(result, { status: result.ok ? 200 : 403 });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Extension connection request is too large." }, { status: 413 });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }
    console.error("[extension-connections-route]", error);
    return Response.json({ ok: false, error: "invalid_request" }, { status: 500 });
  }
}
```

Create `app/api/extension/connections/token/route.ts`:

```ts
import { revokeExtensionBearer } from "@/lib/server/extension/connections";

export async function DELETE(request: Request) {
  const token = readBearerToken(request);
  const extensionId = request.headers.get("x-sf-apt-extension-id")?.trim() ?? "";

  if (!token || !extensionId) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const result = await revokeExtensionBearer({ token, extensionId });
  return Response.json(result, { status: result.ok ? 200 : result.error === "token_expired" ? 401 : 403 });
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}
```

Create `app/api/extension/connections/current/route.ts` with same-origin user auth and `revokeWorkspaceExtensionConnections({ userId, workspaceId })`.

- [ ] **Step 5: Implement connect page**

Create `app/extension/connect/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { extensionIdSchema } from "@/lib/domain/schemas";
import { getCurrentUser } from "@/lib/server/auth/session";
import { isAllowedExtensionId } from "@/lib/server/extension/connections";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export default async function ExtensionConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ extensionId?: string }>;
}) {
  const params = await searchParams;
  const extensionId = params.extensionId ?? "";
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/api/auth/sign-in/google?callbackURL=${encodeURIComponent(`/extension/connect?extensionId=${extensionId}`)}`);
  }

  const parsed = extensionIdSchema.safeParse(extensionId);
  const allowed = parsed.success && isAllowedExtensionId(parsed.data);
  const { workspace } = await getOrCreateDefaultWorkspace(user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <p className="text-xs uppercase text-muted-foreground">Apt Hunt extension</p>
      <h1 className="text-2xl font-semibold">Connect browser extension</h1>
      {allowed ? (
        <ExtensionConnectClient
          accountEmail={user.email}
          extensionId={parsed.data}
          workspaceName={workspace.name}
        />
      ) : (
        <p className="border border-border bg-card p-4 text-sm">
          This extension is not recognized for this Apt Hunt environment.
        </p>
      )}
    </main>
  );
}
```

Create a small client component in `app/extension/connect/extension-connect-client.tsx` to call `POST /api/extension/connections` and then `chrome.runtime.sendMessage(extensionId, response)`. Use `declare global { interface Window { chrome?: unknown } }` or a narrow local `ChromeRuntime` type to avoid `any`.

- [ ] **Step 6: Write failing import route tests**

Create `tests/routes/facebook-listings-import-route.test.ts` with cases:

```ts
test("rejects missing bearer token", async () => {
  const response = await POST(createImportRequest(createBody(), {}));
  expect(response.status).toBe(401);
});

test("rejects non-Facebook URLs", async () => {
  connectionMocks.validateExtensionBearer.mockResolvedValueOnce({
    ok: true,
    userId: "user-1",
    workspaceId: "workspace-1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  const response = await POST(
    createImportRequest({
      ...createBody(),
      sourcePostUrl: "https://example.com/listing",
    }),
  );

  expect(response.status).toBe(400);
});

test("imports valid Facebook listing", async () => {
  connectionMocks.validateExtensionBearer.mockResolvedValueOnce({
    ok: true,
    userId: "user-1",
    workspaceId: "workspace-1",
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  importMocks.importFacebookListing.mockResolvedValueOnce({
    ok: true,
    captureId: "capture-1",
    lead: createLead(),
    listingLedgerRevision: "ledger-2",
  });

  const response = await POST(createImportRequest(createBody()));
  expect(response.status).toBe(200);
});
```

- [ ] **Step 7: Implement import route**

Create `app/api/imports/facebook-listings/route.ts`:

```ts
import { z } from "zod";

import { facebookListingImportRequestSchema } from "@/lib/domain/schemas";
import { validateExtensionBearer } from "@/lib/server/extension/connections";
import { importFacebookListing } from "@/lib/server/imports/facebook-listings";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_FACEBOOK_IMPORT_REQUEST_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const token = readBearerToken(request);
  const extensionId = request.headers.get("x-sf-apt-extension-id")?.trim() ?? "";

  if (!token || !extensionId) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const validation = await validateExtensionBearer({ token, extensionId });

  if (!validation.ok) {
    return Response.json(validation, { status: 401 });
  }

  try {
    const body = facebookListingImportRequestSchema.parse(
      await readJsonRequestBody(request, MAX_FACEBOOK_IMPORT_REQUEST_BYTES),
    );

    if (!isFacebookUrl(body.sourceGroupUrl) || !isFacebookUrl(body.sourcePostUrl)) {
      return Response.json({ ok: false, error: "invalid_group_context" }, { status: 400 });
    }

    const result = await importFacebookListing({
      workspaceId: validation.workspaceId,
      request: body,
    });

    return Response.json(result, {
      status: result.ok ? 200 : result.error === "idempotency_conflict" ? 409 : 400,
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 413 });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }
    console.error("[facebook-listings-import-route]", error);
    return Response.json({ ok: false, error: "import_failed" }, { status: 500 });
  }
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

function isFacebookUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}
```

- [ ] **Step 8: Run route tests**

Run:

```bash
npm run test -- tests/routes/extension-connections-route.test.ts tests/routes/facebook-listings-import-route.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/server/auth/session.ts app/extension/connect app/api/extension app/api/imports tests/routes/extension-connections-route.test.ts tests/routes/facebook-listings-import-route.test.ts
git commit -m "Add extension connection and import routes"
```

---

### Task 6: Extension Scaffold And Connection Storage

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/config.js`
- Create: `extension/storage.js`
- Create: `extension/background.js`
- Create: `extension/popup.html`
- Create: `extension/popup.js`
- Create: `extension/popup.css`
- Test: `tests/unit/extension-storage.test.ts`

**Interfaces:**
- Consumes: app route contracts from Task 5.
- Produces:
  - `getConnection()`
  - `setConnection(connection)`
  - `clearConnection()`
  - `getAllowlistedGroups()`
  - `saveAllowlistedGroup(group)`
  - extension popup connection UI.

- [ ] **Step 1: Write failing storage tests**

Create `tests/unit/extension-storage.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearConnection,
  getConnection,
  saveAllowlistedGroup,
  setConnection,
  getAllowlistedGroups,
} from "../../extension/storage.js";

describe("extension storage", () => {
  beforeEach(() => {
    const store = new Map<string, unknown>();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) =>
            Object.fromEntries(keys.map((key) => [key, store.get(key)])),
          ),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) store.set(key, value);
          }),
          remove: vi.fn(async (key: string) => {
            store.delete(key);
          }),
        },
      },
    });
  });

  test("stores and clears connection", async () => {
    await setConnection({
      token: "token-1",
      expiresAt: "2026-07-30T02:00:00.000Z",
      accountEmail: "tracy@example.com",
      workspaceName: "Apartment hunt",
    });
    expect(await getConnection()).toMatchObject({ accountEmail: "tracy@example.com" });
    await clearConnection();
    expect(await getConnection()).toBeNull();
  });

  test("dedupes allowlisted groups by id", async () => {
    await saveAllowlistedGroup({
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    });
    await saveAllowlistedGroup({
      id: "12345",
      name: "SF Housing Updated",
      url: "https://www.facebook.com/groups/12345",
    });
    expect(await getAllowlistedGroups()).toEqual([
      {
        id: "12345",
        name: "SF Housing Updated",
        url: "https://www.facebook.com/groups/12345",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run storage test and verify failure**

Run: `npm run test -- tests/unit/extension-storage.test.ts`

Expected: FAIL because extension files do not exist.

- [ ] **Step 3: Create manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Apt Hunt Saver",
  "version": "0.1.0",
  "description": "Save reviewed Facebook housing posts to Apt Hunt.",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://www.facebook.com/*", "https://api.openai.com/*", "http://localhost/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "Apt Hunt"
  },
  "content_scripts": [
    {
      "matches": ["https://www.facebook.com/*"],
      "js": ["group-context.js", "capture.js", "content-script.js"],
      "css": ["content-style.css"],
      "run_at": "document_idle"
    }
  ],
  "externally_connectable": {
    "matches": ["http://localhost/*"]
  }
}
```

- [ ] **Step 4: Create config and storage helpers**

Create `extension/config.js`:

```js
export const appOrigin = "http://localhost:3333";
export const extensionIdHeader = "x-sf-apt-extension-id";
```

Create `extension/storage.js`:

```js
const connectionKey = "aptHuntConnection";
const allowlistKey = "aptHuntAllowlistedGroups";

export async function getConnection() {
  const value = await chrome.storage.local.get([connectionKey]);
  return value[connectionKey] ?? null;
}

export async function setConnection(connection) {
  await chrome.storage.local.set({ [connectionKey]: connection });
}

export async function clearConnection() {
  await chrome.storage.local.remove(connectionKey);
}

export async function getAllowlistedGroups() {
  const value = await chrome.storage.local.get([allowlistKey]);
  return Array.isArray(value[allowlistKey]) ? value[allowlistKey] : [];
}

export async function saveAllowlistedGroup(group) {
  const groups = await getAllowlistedGroups();
  const next = [...groups.filter((existing) => existing.id !== group.id), group].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  await chrome.storage.local.set({ [allowlistKey]: next });
  return next;
}

export async function removeAllowlistedGroup(id) {
  const next = (await getAllowlistedGroups()).filter((group) => group.id !== id);
  await chrome.storage.local.set({ [allowlistKey]: next });
  return next;
}
```

- [ ] **Step 5: Create background connection listener**

Create `extension/background.js`:

```js
import { appOrigin, extensionIdHeader } from "./config.js";
import { clearConnection, getConnection, setConnection } from "./storage.js";

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== appOrigin) {
    sendResponse({ ok: false, error: "forbidden_origin" });
    return false;
  }

  if (message?.type !== "apt-hunt-extension-connected" || !message.payload?.token) {
    sendResponse({ ok: false, error: "invalid_message" });
    return false;
  }

  setConnection({
    token: message.payload.token,
    expiresAt: message.payload.expiresAt,
    accountEmail: message.payload.account.email,
    workspaceName: message.payload.workspace.name,
  }).then(() => sendResponse({ ok: true }));

  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "apt-hunt-get-connection") {
    getConnection().then((connection) => sendResponse({ ok: true, connection }));
    return true;
  }

  if (message?.type === "apt-hunt-disconnect") {
    disconnect().then(sendResponse);
    return true;
  }

  return false;
});

async function disconnect() {
  const connection = await getConnection();

  if (!connection?.token) {
    await clearConnection();
    return { ok: true };
  }

  const response = await fetch(`${appOrigin}/api/extension/connections/token`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${connection.token}`,
      [extensionIdHeader]: chrome.runtime.id,
    },
  });

  if (!response.ok) {
    return { ok: false, error: "disconnect_failed" };
  }

  await clearConnection();
  return { ok: true };
}
```

- [ ] **Step 6: Create popup UI**

Create `extension/popup.html`, `extension/popup.js`, and `extension/popup.css` with:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <main>
      <p class="eyebrow">Apt Hunt</p>
      <h1>Facebook saver</h1>
      <section id="connection"></section>
      <section id="allowlist"></section>
    </main>
    <script type="module" src="popup.js"></script>
  </body>
</html>
```

```js
import { appOrigin } from "./config.js";
import { getAllowlistedGroups, saveAllowlistedGroup } from "./storage.js";

const connectionEl = document.querySelector("#connection");
const allowlistEl = document.querySelector("#allowlist");

render();

async function render() {
  const response = await chrome.runtime.sendMessage({ type: "apt-hunt-get-connection" });
  const connection = response.connection;

  connectionEl.innerHTML = connection
    ? `<p>Connected as ${escapeHtml(connection.accountEmail)}</p><button id="disconnect">Disconnect</button>`
    : `<button id="connect">Connect Apt Hunt</button>`;

  document.querySelector("#connect")?.addEventListener("click", () => {
    chrome.tabs.create({
      url: `${appOrigin}/extension/connect?extensionId=${chrome.runtime.id}`,
    });
  });

  document.querySelector("#disconnect")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "apt-hunt-disconnect" });
    await render();
  });

  const groups = await getAllowlistedGroups();
  allowlistEl.innerHTML = `<h2>Allowlisted groups</h2>${groups
    .map((group) => `<p>${escapeHtml(group.name)}</p>`)
    .join("")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
```

Style with compact app-like mono UI:

```css
body {
  width: 320px;
  margin: 0;
  font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #28251f;
  background: #fffdfa;
}
main {
  display: grid;
  gap: 12px;
  padding: 14px;
}
button {
  border: 1px solid #d9d3c8;
  background: #f4f1eb;
  padding: 8px 10px;
  font: inherit;
}
.eyebrow {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  color: #777064;
}
h1,
h2,
p {
  margin: 0;
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm run test -- tests/unit/extension-storage.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add extension tests/unit/extension-storage.test.ts
git commit -m "Scaffold Facebook saver extension"
```

---

### Task 7: Facebook Group Context And Capture

**Files:**
- Create: `extension/group-context.js`
- Create: `extension/capture.js`
- Create: `extension/content-script.js`
- Create: `extension/content-style.css`
- Test: `tests/unit/extension-group-context.test.ts`
- Test: `tests/unit/extension-capture.test.ts`
- Fixture: `tests/e2e/extension-fixtures/facebook-group-post.html`

**Interfaces:**
- Consumes: extension storage allowlist from Task 6.
- Produces:
  - `parseFacebookGroupFromUrl(url): GroupContext | null`
  - `readGroupContextFromDocument(document, location): GroupContext | null`
  - `capturePost(postElement, groupContext): CapturedPost`

- [ ] **Step 1: Write failing parser tests**

Create `tests/unit/extension-group-context.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  parseFacebookGroupFromUrl,
  readGroupContextFromDocument,
} from "../../extension/group-context.js";

describe("Facebook group context parser", () => {
  test("parses group feed urls", () => {
    expect(parseFacebookGroupFromUrl("https://www.facebook.com/groups/12345")).toEqual({
      id: "12345",
      name: "Facebook group 12345",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("parses group post permalink urls", () => {
    expect(parseFacebookGroupFromUrl("https://www.facebook.com/groups/12345/posts/67890")).toEqual({
      id: "12345",
      name: "Facebook group 12345",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("reads visible home-feed group attribution", () => {
    const document = new DOMParser().parseFromString(
      `<article><a href="https://www.facebook.com/groups/12345">SF Housing</a></article>`,
      "text/html",
    );
    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toEqual({
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    });
  });
});
```

- [ ] **Step 2: Write failing capture tests**

Create `tests/unit/extension-capture.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { capturePost } from "../../extension/capture.js";

describe("Facebook post capture", () => {
  test("captures visible post text and post permalink", () => {
    const document = new DOMParser().parseFromString(
      `<article data-apt-hunt-post>
        <p>Room in Hayes Valley, $1800.</p>
        <a href="https://www.facebook.com/groups/12345/posts/67890">Permalink</a>
      </article>`,
      "text/html",
    );
    const post = document.querySelector("article");
    expect(capturePost(post, {
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    })).toMatchObject({
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: expect.stringContaining("Room in Hayes Valley"),
    });
  });
});
```

- [ ] **Step 3: Run parser/capture tests and verify failure**

Run: `npm run test -- tests/unit/extension-group-context.test.ts tests/unit/extension-capture.test.ts`

Expected: FAIL because parser/capture modules do not exist.

- [ ] **Step 4: Implement group parser**

Create `extension/group-context.js`:

```js
export function parseFacebookGroupFromUrl(value) {
  const url = safeUrl(value);

  if (!url || !url.hostname.endsWith("facebook.com")) {
    return null;
  }

  const match = url.pathname.match(/^\/groups\/([^/?#]+)(?:\/posts\/[^/?#]+)?/);

  if (!match) {
    return null;
  }

  const id = decodeURIComponent(match[1]);
  return {
    id,
    name: `Facebook group ${id}`,
    url: `https://www.facebook.com/groups/${encodeURIComponent(id)}`,
  };
}

export function readGroupContextFromDocument(document, location) {
  const fromLocation = parseFacebookGroupFromUrl(location.href);

  if (fromLocation) {
    const heading = document.querySelector("h1")?.textContent?.trim();
    return heading ? { ...fromLocation, name: heading } : fromLocation;
  }

  const links = [...document.querySelectorAll('a[href*="/groups/"]')];

  for (const link of links) {
    const parsed = parseFacebookGroupFromUrl(link.href);

    if (parsed) {
      return {
        ...parsed,
        name: link.textContent?.trim() || parsed.name,
      };
    }
  }

  return null;
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement capture serializer**

Create `extension/capture.js`:

```js
export function capturePost(postElement, groupContext) {
  if (!postElement || !groupContext) {
    return null;
  }

  const sourcePostUrl = findPostUrl(postElement) ?? window.location.href;
  const capturedText = postElement.textContent?.replace(/\s+/g, " ").trim() ?? "";

  if (!capturedText) {
    return null;
  }

  return {
    sourceSurface: inferSurface(sourcePostUrl),
    sourceGroupId: groupContext.id,
    sourceGroupName: groupContext.name,
    sourceGroupUrl: groupContext.url,
    sourcePostUrl,
    capturedText,
    capturedAt: new Date().toISOString(),
  };
}

function findPostUrl(postElement) {
  const links = [...postElement.querySelectorAll("a[href]")].map((link) => link.href);
  return links.find((href) => /\/groups\/[^/]+\/posts\//.test(new URL(href).pathname)) ?? null;
}

function inferSurface(sourcePostUrl) {
  return /\/groups\/[^/]+\/posts\//.test(new URL(sourcePostUrl).pathname)
    ? "postPermalink"
    : window.location.pathname.startsWith("/groups/")
      ? "groupFeed"
      : "homeFeed";
}
```

- [ ] **Step 6: Implement content script injection**

Create `extension/content-script.js`:

```js
import { capturePost } from "./capture.js";
import { readGroupContextFromDocument } from "./group-context.js";

const buttonClass = "apt-hunt-save-button";

observe();
injectButtons();

function observe() {
  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.body, { childList: true, subtree: true });
}

async function injectButtons() {
  const response = await chrome.runtime.sendMessage({ type: "apt-hunt-get-allowlist" }).catch(() => null);
  const allowlist = response?.groups ?? [];
  const groupContext = readGroupContextFromDocument(document, window.location);

  if (!groupContext || !allowlist.some((group) => group.id === groupContext.id)) {
    return;
  }

  for (const post of findPosts()) {
    if (post.querySelector(`.${buttonClass}`)) {
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = buttonClass;
    button.textContent = "Save to Apt Hunt";
    button.addEventListener("click", () => {
      const capture = capturePost(post, groupContext);
      if (capture) {
        chrome.runtime.sendMessage({ type: "apt-hunt-review-capture", capture });
      }
    });
    post.append(button);
  }
}

function findPosts() {
  return [...document.querySelectorAll('[role="article"], article')];
}
```

Update `extension/background.js` to handle `apt-hunt-get-allowlist`:

```js
import { getAllowlistedGroups } from "./storage.js";

if (message?.type === "apt-hunt-get-allowlist") {
  getAllowlistedGroups().then((groups) => sendResponse({ ok: true, groups }));
  return true;
}
```

Create `extension/content-style.css`:

```css
.apt-hunt-save-button {
  margin: 8px 0 0;
  border: 1px solid #d9d3c8;
  background: #fffdfa;
  color: #28251f;
  padding: 6px 8px;
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

- [ ] **Step 7: Add fixture HTML**

Create `tests/e2e/extension-fixtures/facebook-group-post.html`:

```html
<!doctype html>
<html>
  <body>
    <h1>SF Housing</h1>
    <article role="article">
      <p>Room in Hayes Valley, $1800, available July 15.</p>
      <a href="https://www.facebook.com/groups/12345/posts/67890">Permalink</a>
    </article>
  </body>
</html>
```

- [ ] **Step 8: Run parser/capture tests**

Run:

```bash
npm run test -- tests/unit/extension-group-context.test.ts tests/unit/extension-capture.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/group-context.js extension/capture.js extension/content-script.js extension/content-style.css tests/unit/extension-group-context.test.ts tests/unit/extension-capture.test.ts tests/e2e/extension-fixtures/facebook-group-post.html
git commit -m "Add Facebook post detection and capture"
```

---

### Task 8: Review UI And Import From Extension

**Files:**
- Create: `extension/review.html`
- Create: `extension/review.js`
- Create: `extension/review.css`
- Modify: `extension/background.js`
- Test: `tests/unit/extension-review.test.ts`

**Interfaces:**
- Consumes: captured post object from Task 7 and app import route from Task 5.
- Produces:
  - `buildImportRequest(capture, details, incompleteFlags)`
  - review window save flow with idempotency key.

- [ ] **Step 1: Write failing review request test**

Create `tests/unit/extension-review.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { buildImportRequest } from "../../extension/review.js";

describe("extension review import request", () => {
  test("builds an incomplete save request with idempotency key", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });

    expect(
      buildImportRequest(
        {
          sourceSurface: "groupFeed",
          sourceGroupId: "12345",
          sourceGroupName: "SF Housing",
          sourceGroupUrl: "https://www.facebook.com/groups/12345",
          sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
          capturedText: "Room in Hayes Valley",
          capturedAt: "2026-06-30T02:00:00.000Z",
        },
        null,
        ["missing_price"],
      ),
    ).toMatchObject({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      reviewedDetails: null,
      incompleteFlags: ["missing_price"],
    });
  });
});
```

- [ ] **Step 2: Run review test and verify failure**

Run: `npm run test -- tests/unit/extension-review.test.ts`

Expected: FAIL because `extension/review.js` does not exist.

- [ ] **Step 3: Add background review orchestration**

In `extension/background.js`, add an in-memory capture store:

```js
const pendingCaptures = new Map();

if (message?.type === "apt-hunt-review-capture") {
  const captureId = crypto.randomUUID();
  pendingCaptures.set(captureId, message.capture);
  chrome.windows.create({
    url: chrome.runtime.getURL(`review.html?captureId=${encodeURIComponent(captureId)}`),
    type: "popup",
    width: 460,
    height: 680,
  });
  sendResponse({ ok: true, captureId });
  return false;
}

if (message?.type === "apt-hunt-get-pending-capture") {
  sendResponse({ ok: true, capture: pendingCaptures.get(message.captureId) ?? null });
  return false;
}

if (message?.type === "apt-hunt-import-capture") {
  importCapture(message.request).then(sendResponse);
  return true;
}
```

Add import function:

```js
async function importCapture(request) {
  const connection = await getConnection();

  if (!connection?.token) {
    return { ok: false, error: "not_connected" };
  }

  const response = await fetch(`${appOrigin}/api/imports/facebook-listings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${connection.token}`,
      [extensionIdHeader]: chrome.runtime.id,
    },
    body: JSON.stringify(request),
  });

  return response.json();
}
```

- [ ] **Step 4: Add review HTML/CSS/JS**

Create `extension/review.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="review.css" />
  </head>
  <body>
    <main>
      <p class="eyebrow">Apt Hunt</p>
      <h1>Review listing</h1>
      <section id="capture"></section>
      <form id="review-form">
        <label>Price/month <input name="priceMonthly" inputmode="numeric" /></label>
        <label>Listing type
          <select name="listingType">
            <option value="unknown">Unknown</option>
            <option value="full_apartment">Full apartment</option>
            <option value="private_room">Private room</option>
            <option value="shared_room">Shared room</option>
            <option value="roommate_search">Roommate search</option>
          </select>
        </label>
        <label>Tenancy type
          <select name="tenancyType">
            <option value="unknown">Unknown</option>
            <option value="new_lease">New lease</option>
            <option value="lease_takeover">Lease takeover</option>
            <option value="sublet">Sublet</option>
            <option value="month_to_month">Month to month</option>
          </select>
        </label>
        <label>Location <input name="locationText" /></label>
        <label>Neighborhood <input name="neighborhoodGuess" /></label>
        <label>Bedrooms <input name="bedrooms" /></label>
        <label>Bathroom
          <select name="bathroom">
            <option value="unknown">Unknown</option>
            <option value="private">Private</option>
            <option value="shared">Shared</option>
          </select>
        </label>
        <label>Roommates <input name="roommateCount" inputmode="numeric" /></label>
        <label>Start date <input name="availabilityStart" /></label>
        <label>End date <input name="availabilityEnd" /></label>
        <label>Duration <input name="durationText" /></label>
        <label>Notes <textarea name="notes"></textarea></label>
        <div class="actions">
          <button type="submit">Save reviewed</button>
          <button type="button" id="save-incomplete">Save incomplete</button>
        </div>
      </form>
      <p id="status"></p>
    </main>
    <script type="module" src="review.js"></script>
  </body>
</html>
```

Create `extension/review.js` with exported builder:

```js
export function buildImportRequest(capture, reviewedDetails, incompleteFlags) {
  return {
    idempotencyKey: crypto.randomUUID(),
    ...capture,
    parsedDraft: null,
    reviewedDetails,
    incompleteFlags,
  };
}

const params = new URLSearchParams(location.search);
const captureId = params.get("captureId");
const statusEl = document.querySelector("#status");
const form = document.querySelector("#review-form");
const incompleteButton = document.querySelector("#save-incomplete");

if (captureId && form) {
  init(captureId);
}

async function init(id) {
  const response = await chrome.runtime.sendMessage({ type: "apt-hunt-get-pending-capture", captureId: id });
  const capture = response.capture;
  document.querySelector("#capture").textContent = capture?.capturedText ?? "Capture not found.";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await save(buildImportRequest(capture, readDetails(new FormData(form)), []));
  });

  incompleteButton.addEventListener("click", async () => {
    await save(buildImportRequest(capture, null, ["saved_incomplete"]));
  });
}

async function save(request) {
  statusEl.textContent = "Saving...";
  const response = await chrome.runtime.sendMessage({ type: "apt-hunt-import-capture", request });
  statusEl.textContent = response.ok ? "Saved" : `Save failed: ${response.error}`;
}

function readDetails(formData) {
  const price = Number.parseInt(formData.get("priceMonthly") || "", 10);
  const roommateCount = Number.parseInt(formData.get("roommateCount") || "", 10);
  const bedroomsValue = String(formData.get("bedrooms") || "").trim();

  return {
    listingType: String(formData.get("listingType") || "unknown"),
    tenancyType: String(formData.get("tenancyType") || "unknown"),
    priceMonthly: Number.isFinite(price) ? price : null,
    bedrooms: bedroomsValue === "studio" ? "studio" : Number.isFinite(Number.parseInt(bedroomsValue, 10)) ? Number.parseInt(bedroomsValue, 10) : null,
    bathroom: String(formData.get("bathroom") || "unknown"),
    roommateCount: Number.isFinite(roommateCount) ? roommateCount : null,
    locationText: stringOrNull(formData.get("locationText")),
    neighborhoodGuess: String(formData.get("neighborhoodGuess") || "Unknown"),
    availabilityStart: stringOrNull(formData.get("availabilityStart")),
    availabilityEnd: stringOrNull(formData.get("availabilityEnd")),
    dateFlexibility: "unknown",
    durationText: stringOrNull(formData.get("durationText")),
    furnished: null,
    pets: "unknown",
    notes: String(formData.get("notes") || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text ? text : null;
}
```

Style `review.css` with the same compact app-like treatment as `popup.css`, using dense labels and fixed action row.

- [ ] **Step 5: Run review tests**

Run:

```bash
npm run test -- tests/unit/extension-review.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/review.html extension/review.js extension/review.css extension/background.js tests/unit/extension-review.test.ts
git commit -m "Add extension listing review flow"
```

---

### Task 9: Optional Extension AI Parser

**Files:**
- Create: `extension/openai-parser.js`
- Modify: `extension/storage.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/review.html`
- Modify: `extension/review.js`
- Test: `tests/unit/extension-openai-parser.test.ts`

**Interfaces:**
- Consumes: captured text from Task 7 and review form from Task 8.
- Produces:
  - `getOpenAiKey()`
  - `setOpenAiKey(key)`
  - `parseHousingDetailsWithOpenAI(input)`

- [ ] **Step 1: Write failing parser tests**

Create `tests/unit/extension-openai-parser.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { parseHousingDetailsWithOpenAI } from "../../extension/openai-parser.js";

describe("extension OpenAI parser", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      listingType: "private_room",
                      tenancyType: "sublet",
                      priceMonthly: 1800,
                      bedrooms: 2,
                      bathroom: "shared",
                      roommateCount: 2,
                      locationText: "Hayes Valley",
                      neighborhoodGuess: "Hayes Valley",
                      availabilityStart: "2026-07-15",
                      availabilityEnd: "2026-10-15",
                      dateFlexibility: "flexible",
                      durationText: "3 months",
                      furnished: true,
                      pets: "unknown",
                      notes: ["Utilities not confirmed"],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  test("requests strict structured housing details with store false", async () => {
    const result = await parseHousingDetailsWithOpenAI({
      apiKey: "sk-test",
      capturedText: "Room in Hayes Valley, $1800, available July 15.",
      sourceGroupName: "SF Housing",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.details.priceMonthly).toBe(1800);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
        }),
      }),
    );
    const body = JSON.parse(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1].body));
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
  });
});
```

- [ ] **Step 2: Run parser test and verify failure**

Run: `npm run test -- tests/unit/extension-openai-parser.test.ts`

Expected: FAIL because `extension/openai-parser.js` does not exist.

- [ ] **Step 3: Implement parser module**

Create `extension/openai-parser.js`:

```js
const housingDetailsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "listingType",
    "tenancyType",
    "priceMonthly",
    "bedrooms",
    "bathroom",
    "roommateCount",
    "locationText",
    "neighborhoodGuess",
    "availabilityStart",
    "availabilityEnd",
    "dateFlexibility",
    "durationText",
    "furnished",
    "pets",
    "notes",
  ],
  properties: {
    listingType: {
      type: "string",
      enum: ["full_apartment", "private_room", "shared_room", "roommate_search", "unknown"],
    },
    tenancyType: {
      type: "string",
      enum: ["new_lease", "lease_takeover", "sublet", "month_to_month", "unknown"],
    },
    priceMonthly: { type: ["integer", "null"] },
    bedrooms: { anyOf: [{ type: "integer" }, { const: "studio" }, { type: "null" }] },
    bathroom: { type: "string", enum: ["private", "shared", "unknown"] },
    roommateCount: { type: ["integer", "null"] },
    locationText: { type: ["string", "null"] },
    neighborhoodGuess: { type: "string" },
    availabilityStart: { type: ["string", "null"] },
    availabilityEnd: { type: ["string", "null"] },
    dateFlexibility: { type: "string", enum: ["fixed", "flexible", "unknown"] },
    durationText: { type: ["string", "null"] },
    furnished: { type: ["boolean", "null"] },
    pets: { type: "string", enum: ["allowed", "not_allowed", "unknown"] },
    notes: { type: "array", items: { type: "string" }, maxItems: 50 },
  },
};

export async function parseHousingDetailsWithOpenAI({ apiKey, capturedText, sourceGroupName }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      store: false,
      input: [
        {
          role: "system",
          content:
            "Extract structured housing listing details from a Facebook post. Use unknown or null when the post does not say.",
        },
        {
          role: "user",
          content: `Group: ${sourceGroupName}\n\nPost:\n${capturedText}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "housing_details",
          strict: true,
          schema: housingDetailsJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    return { ok: false, error: "openai_request_failed" };
  }

  const data = await response.json();
  const text = data.output?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === "output_text")?.text;

  if (!text) {
    return { ok: false, error: "missing_structured_output" };
  }

  return { ok: true, details: JSON.parse(text) };
}
```

- [ ] **Step 4: Add OpenAI key storage helpers**

Modify `extension/storage.js`:

```js
const openAiKey = "aptHuntOpenAiKey";

export async function getOpenAiKey() {
  const value = await chrome.storage.local.get([openAiKey]);
  return typeof value[openAiKey] === "string" ? value[openAiKey] : "";
}

export async function setOpenAiKey(key) {
  const trimmed = key.trim();

  if (!trimmed) {
    await chrome.storage.local.remove(openAiKey);
    return "";
  }

  await chrome.storage.local.set({ [openAiKey]: trimmed });
  return trimmed;
}
```

- [ ] **Step 5: Add popup key input**

In `extension/popup.html`, add:

```html
<section id="openai-key"></section>
```

In `extension/popup.js`, import `getOpenAiKey` and `setOpenAiKey`, then render:

```js
const openAiKeyEl = document.querySelector("#openai-key");

async function renderOpenAiKey() {
  const key = await getOpenAiKey();
  openAiKeyEl.innerHTML = `
    <h2>AI parsing</h2>
    <input id="openai-key-input" type="password" placeholder="OpenAI API key" value="${escapeHtml(key)}" />
    <button id="save-openai-key">Save key</button>
  `;
  document.querySelector("#save-openai-key").addEventListener("click", async () => {
    await setOpenAiKey(document.querySelector("#openai-key-input").value);
    await renderOpenAiKey();
  });
}
```

Call `await renderOpenAiKey()` inside `render()`.

- [ ] **Step 6: Add Parse with AI button to review**

In `extension/review.html`, add inside `.actions` before save buttons:

```html
<button type="button" id="parse-with-ai">Parse with AI</button>
```

In `extension/review.js`, import parser/storage helpers:

```js
import { parseHousingDetailsWithOpenAI } from "./openai-parser.js";
import { getOpenAiKey } from "./storage.js";
```

Add after capture load:

```js
document.querySelector("#parse-with-ai").addEventListener("click", async () => {
  const apiKey = await getOpenAiKey();

  if (!apiKey) {
    statusEl.textContent = "Add an OpenAI key in the extension popup first.";
    return;
  }

  statusEl.textContent = "Parsing...";
  const parsed = await parseHousingDetailsWithOpenAI({
    apiKey,
    capturedText: capture.capturedText,
    sourceGroupName: capture.sourceGroupName,
  });

  if (!parsed.ok) {
    statusEl.textContent = "Parsing failed.";
    return;
  }

  writeDetailsToForm(parsed.details);
  statusEl.textContent = "Parsed. Review before saving.";
});
```

Add `writeDetailsToForm(details)`:

```js
function writeDetailsToForm(details) {
  for (const [key, value] of Object.entries(details)) {
    const field = form.elements.namedItem(key);

    if (!field) {
      continue;
    }

    field.value = Array.isArray(value) ? value.join("\n") : value ?? "";
  }
}
```

- [ ] **Step 7: Run parser tests**

Run:

```bash
npm run test -- tests/unit/extension-openai-parser.test.ts tests/unit/extension-review.test.ts tests/unit/extension-storage.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add extension/openai-parser.js extension/storage.js extension/popup.html extension/popup.js extension/review.html extension/review.js tests/unit/extension-openai-parser.test.ts
git commit -m "Add optional extension AI parsing"
```

---

### Task 10: Environment, Docs, And Local Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/superpowers/plans/2026-06-30-facebook-extension-manual-test.md`

**Interfaces:**
- Consumes: extension and app routes from prior tasks.
- Produces: local setup instructions.

- [ ] **Step 1: Update `.env.example`**

Add:

```txt
# Browser extension. Comma-separated Chrome extension ids allowed to receive import tokens.
EXTENSION_ALLOWED_IDS=
```

- [ ] **Step 2: Update README local setup**

Add a section:

```md
### Facebook saver extension local setup

1. Start the app with `npm run dev`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose "Load unpacked" and select the repository `extension/` directory.
5. Copy the loaded extension id.
6. Set `EXTENSION_ALLOWED_IDS=<copied id>` in `.env.local`.
7. Restart `npm run dev`.
8. In the extension popup, click `Connect Apt Hunt`.
9. Add a Facebook group to the allowlist.
10. Open a group post and click `Save to Apt Hunt`.
```

- [ ] **Step 3: Add manual test checklist**

Create `docs/superpowers/plans/2026-06-30-facebook-extension-manual-test.md`:

```md
# Facebook Extension Manual Test

- [ ] `npm run dev` is running on `http://localhost:3333`.
- [ ] `.env.local` contains `EXTENSION_ALLOWED_IDS=<loaded extension id>`.
- [ ] The extension is loaded unpacked from `extension/`.
- [ ] Extension popup shows disconnected state.
- [ ] `Connect Apt Hunt` opens `/extension/connect?extensionId=<id>`.
- [ ] Signed-in connect succeeds and popup shows the account email.
- [ ] A Facebook group can be added to the allowlist.
- [ ] A fixture/group post receives `Save to Apt Hunt`.
- [ ] Save reviewed returns `Saved`.
- [ ] The listing appears in the app listing ledger after refresh.
- [ ] Popup disconnect revokes the token; a subsequent import fails until reconnect.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md docs/superpowers/plans/2026-06-30-facebook-extension-manual-test.md
git commit -m "Document Facebook extension setup"
```

---

## Plan Self-Review

Spec coverage:

- Same website login and workspace sync: Task 3 and Task 5.
- Server-side extension id allowlist: Task 3 and Task 5.
- Extension-token disconnect: Task 3, Task 5, and Task 6.
- Idempotent imports: Task 2 and Task 4.
- Housing details with notes: Task 1 and Task 4.
- App import route into listing ledger and capture table: Task 4 and Task 5.
- Extension allowlist and popup: Task 6.
- Facebook post detection and home/group context parsing: Task 7.
- Review/edit and save incomplete: Task 8.
- Optional browser-local OpenAI parsing: Task 9.
- Local setup and manual verification: Task 10.

Type consistency:

- `HousingDetails.notes` is defined in Task 1, used in DB JSON in Task 2, normalized into candidate caveats in Task 4, and emitted by the review UI in Task 8.
- `idempotencyKey` is defined in Task 1, stored in Task 2, enforced in Task 4, and generated in Task 8.
- `extensionId` is validated in Task 1, allowlisted in Task 3, passed by routes in Task 5, and supplied by Chrome runtime in Task 6.

Verification:

- Each implementation task starts with a failing test.
- Each task has a focused test command and commit command.
- Final verification runs lint, typecheck, unit/route tests, and build.
