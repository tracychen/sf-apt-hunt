# Persistent Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-backed durable persistence so signed-in users can access the same map, listings, planning chat, and future imports across devices.

**Architecture:** Better Auth with Google OAuth owns authentication. Drizzle owns the Neon Postgres schema and migrations. Signed-in workspace APIs become the source of truth for map state, listing leads, geocode updates, and planning chat state while the existing localStorage path remains as unsigned/dev compatibility during transition.

**Tech Stack:** Next.js 16 App Router, React 19, Better Auth, Drizzle ORM, Neon Postgres, Zod, Vitest, Playwright.

## Global Constraints

- Auth: Better Auth.
- Sign-in provider: Google OAuth only in v1.
- Database: Neon Postgres.
- ORM and migrations: Drizzle.
- Workspace model: one default workspace per user in v1.
- Source of truth: Postgres for signed-in users.
- No automatic migration from old localStorage into accounts.
- JSON import/export remains the manual bridge for old maps or alternate versions.
- Do not store the user's OpenAI API key server-side in v1.
- The browser extension import API is future scope and must not be implemented in this persistence slice.
- Signed-in mutating routes must validate the Better Auth session and enforce same-origin/CSRF checks.
- Workspace writes must use revisions and return `409 Conflict` on stale map/listing revisions.
- Feature code should not touch `window.localStorage` directly; keep using wrappers for the unsigned/dev path.
- Domain coordinates remain `[lng, lat]`; Leaflet remains `[lat, lng]` only at the Leaflet boundary.

---

## File Structure

Create:

- `drizzle.config.ts` - Drizzle Kit configuration for migrations.
- `lib/db/schema.ts` - Better Auth and Apt Hunt Drizzle table definitions.
- `lib/db/client.ts` - server-only database connection.
- `lib/db/workspace-revisions.ts` - revision id helpers.
- `lib/server/auth/config.ts` - Better Auth configuration.
- `lib/server/auth/session.ts` - session and current-user helpers for route handlers.
- `lib/server/security/origin.ts` - same-origin/CSRF guard for mutating route handlers.
- `lib/server/workspaces.ts` - default workspace creation and ownership helpers.
- `lib/server/workspace-state.ts` - DB-backed map snapshot operations.
- `lib/server/listing-leads-db.ts` - DB-backed listing ledger and geocode write operations.
- `lib/server/planning/store-db.ts` - DB-backed planning store implementation.
- `app/api/auth/[...all]/route.ts` - Better Auth route handler.
- `app/api/workspace/route.ts` - load/create current workspace.
- `app/api/workspace/map/route.ts` - revisioned map write.
- `app/api/workspace/map/import/route.ts` - revisioned JSON map import.
- `app/api/workspace/map/export/route.ts` - JSON map export.
- `app/api/workspace/listings/route.ts` - list workspace listing leads.
- `app/api/workspace/listings/[id]/route.ts` - revisioned listing status update.
- `app/api/workspace/geocode-cache/route.ts` - revisioned geocode cache/listing update.
- `app/api/workspace/reset/route.ts` - reset current workspace data.
- `app/api/workspace/client-state/route.ts` - hydrate signed-in app state for client rendering.
- `components/auth/sign-in-panel.tsx` - compact signed-out Google sign-in UI.
- `components/apartment-map/persistent-apartment-map-app.tsx` - signed-in client container.
- `components/apartment-map/persistence-types.ts` - shared client-side DB state types.
- `tests/unit/workspace-revisions.test.ts`
- `tests/unit/workspaces.test.ts`
- `tests/unit/workspace-state.test.ts`
- `tests/unit/listing-leads-db.test.ts`
- `tests/unit/planning-store-db.test.ts`
- `tests/routes/workspace-route.test.ts`
- `tests/routes/workspace-map-route.test.ts`
- `tests/routes/workspace-listings-route.test.ts`
- `tests/routes/workspace-geocode-cache-route.test.ts`
- `tests/routes/workspace-reset-route.test.ts`
- `tests/e2e/persistent-workspace.spec.ts`

Modify:

- `package.json` - add Better Auth, Drizzle, Neon/Postgres, migration scripts.
- `app/layout.tsx` - wrap with Better Auth provider only if required by the chosen Better Auth client API.
- `app/page.tsx` - branch between signed-in persistent app and unsigned local app.
- `components/apartment-map/apartment-map-app.tsx` - extract reusable presentational/state pieces only where necessary; keep unsigned behavior intact.
- `components/apartment-map/sidebar.tsx` - support DB-backed import/export/reset props without changing visual layout.
- `components/apartment-map/planning-chat-panel.tsx` - accept signed-in ownership mode and workspace revisions.
- `app/api/ai/planning-chat/route.ts` - use workspace session ownership when signed in.
- `app/api/planning/actions/execute/route.ts` - use workspace session ownership when signed in.
- `app/api/planning/reset/route.ts` - route signed-in reset through workspace planning reset.
- `lib/domain/types.ts` - add workspace/persistence route types and DB-oriented planning row types.
- `lib/domain/schemas.ts` - add Zod schemas for workspace route contracts and housing details.
- `lib/server/planning/store.ts` - add a workspace-owned planning store interface while preserving local/dev store.
- `.env.example` - document `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

---

### Task 1: Dependencies, Environment, And Drizzle Schema

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Create: `lib/db/workspace-revisions.ts`
- Modify: `.env.example`
- Test: `tests/unit/workspace-revisions.test.ts`

**Interfaces:**
- Produces: `createRevision(prefix: string): string`
- Produces: Drizzle tables `users`, `sessions`, `accounts`, `verifications`, `workspaces`, `mapSnapshots`, `listingLeads`, `planningThreads`, `planningMessages`, `planningActions`, `planningActionExecutions`, `geocodeCacheEntries`, `facebookListingCaptures`
- Produces: `db` database client exported from `lib/db/client.ts`
- Consumes: existing domain types `MapState`, `ListingCandidate`, `PlanningChatPart`, `PlanningContextSummary`, `PlanningActionRecord`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install better-auth drizzle-orm postgres
npm install -D drizzle-kit
```

Expected: `package.json` and lockfile include Better Auth, Drizzle, the postgres-js driver, and Drizzle Kit. The postgres-js driver is required because the workspace write helpers in Task 3 use Drizzle transactions.

- [ ] **Step 2: Add scripts to `package.json`**

Add these scripts:

```json
{
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio"
}
```

- [ ] **Step 3: Write the revision helper test**

Create `tests/unit/workspace-revisions.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createRevision } from "@/lib/db/workspace-revisions";

describe("workspace revisions", () => {
  test("creates prefixed unique revision ids", () => {
    const left = createRevision("map");
    const right = createRevision("map");

    expect(left).toMatch(/^map-[0-9a-f-]{36}$/);
    expect(right).toMatch(/^map-[0-9a-f-]{36}$/);
    expect(left).not.toBe(right);
  });
});
```

- [ ] **Step 4: Run the revision helper test to verify it fails**

Run:

```bash
npm run test -- tests/unit/workspace-revisions.test.ts
```

Expected: FAIL because `lib/db/workspace-revisions.ts` does not exist.

- [ ] **Step 5: Implement `lib/db/workspace-revisions.ts`**

Create `lib/db/workspace-revisions.ts`:

```ts
export function createRevision(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
```

- [ ] **Step 6: Create `drizzle.config.ts`**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 7: Create `lib/db/client.ts`**

Create `lib/db/client.ts`:

```ts
import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL is required in production.");
}

const sql = databaseUrl ? postgres(databaseUrl, { prepare: false }) : null;

export const db = sql ? drizzle(sql, { schema }) : null;

export function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is required for persistent workspace operations.");
  }

  return db;
}
```

- [ ] **Step 8: Create `lib/db/schema.ts`**

Create `lib/db/schema.ts` with Drizzle tables. Use `jsonb().$type<T>()` for domain payloads and enforce the constraints from the spec.

```ts
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import type {
  ListingCandidate,
  MapState,
  PlanningActionRecord,
  PlanningActionTarget,
  PlanningChatPart,
  PlanningContextSummary,
  ResearchConfidence,
} from "@/lib/domain/types";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    listingLedgerRevision: text("listing_ledger_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("workspace_user_id_unique").on(table.userId)],
);

export const mapSnapshots = pgTable(
  "map_snapshot",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: text("revision").notNull(),
    mapState: jsonb("map_state").$type<MapState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("map_snapshot_workspace_id_unique").on(table.workspaceId)],
);

export const listingLeads = pgTable(
  "listing_lead",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastSearchQuery: text("last_search_query").notNull(),
    seenCount: integer("seen_count").notNull(),
    status: text("status", { enum: ["new", "seen", "saved", "dismissed"] }).notNull(),
    candidate: jsonb("candidate").$type<ListingCandidate>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("listing_lead_workspace_canonical_url_unique").on(
      table.workspaceId,
      table.canonicalUrl,
    ),
    index("listing_lead_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const planningThreads = pgTable(
  "planning_thread",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("planning_thread_workspace_updated_idx").on(table.workspaceId, table.updatedAt)],
);

export const planningMessages = pgTable(
  "planning_message",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => planningThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: jsonb("parts").$type<PlanningChatPart[]>().notNull(),
    contextSummary: jsonb("context_summary").$type<PlanningContextSummary>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("planning_message_workspace_thread_created_idx").on(
      table.workspaceId,
      table.threadId,
      table.createdAt,
    ),
  ],
);

export const planningActions = pgTable(
  "planning_action",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => planningThreads.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => planningMessages.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    kind: text("kind", {
      enum: ["mapProposal", "mapProposalItem", "listingSave", "listingDismiss", "targetEdit"],
    }).notNull(),
    target: jsonb("target").$type<PlanningActionTarget>().notNull(),
    status: text("status", { enum: ["pending", "applied", "dismissed", "failed"] }).notNull(),
    error: text("error"),
    failureKind: text("failure_kind", { enum: ["retryable", "permanent"] }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("planning_action_workspace_thread_status_idx").on(
      table.workspaceId,
      table.threadId,
      table.status,
    ),
  ],
);

export const planningActionExecutions = pgTable(
  "planning_action_execution",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actionId: text("action_id")
      .notNull()
      .references(() => planningActions.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("planning_action_execution_idempotency_unique").on(
      table.actionId,
      table.idempotencyKey,
    ),
    index("planning_action_execution_workspace_action_idx").on(table.workspaceId, table.actionId),
  ],
);

export const geocodeCacheEntries = pgTable(
  "geocode_cache_entry",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    queryHash: text("query_hash").notNull(),
    query: text("query").notNull(),
    result: jsonb("result").$type<Partial<ListingCandidate>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("geocode_cache_workspace_query_hash_unique").on(table.workspaceId, table.queryHash),
  ],
);

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
};

export const facebookListingCaptures = pgTable(
  "facebook_listing_capture",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceSurface: text("source_surface", {
      enum: ["homeFeed", "groupFeed", "postPermalink"],
    }).notNull(),
    sourceGroupId: text("source_group_id").notNull(),
    sourceGroupName: text("source_group_name").notNull(),
    sourceGroupUrl: text("source_group_url").notNull(),
    sourcePostUrl: text("source_post_url").notNull(),
    capturedText: text("captured_text").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    parsedDraft: jsonb("parsed_draft").$type<HousingDetails>(),
    reviewedDetails: jsonb("reviewed_details").$type<HousingDetails>(),
    incompleteFlags: jsonb("incomplete_flags").$type<string[]>().notNull(),
    listingLeadId: text("listing_lead_id").references(() => listingLeads.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("facebook_capture_workspace_created_idx").on(table.workspaceId, table.createdAt)],
);
```

- [ ] **Step 9: Update `.env.example`**

Ensure `.env.example` includes:

```txt
DATABASE_URL=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3333
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 10: Run tests and schema checks**

Run:

```bash
npm run test -- tests/unit/workspace-revisions.test.ts
npx drizzle-kit generate --config drizzle.config.ts
npm run typecheck
```

Expected:
- revision helper test passes
- Drizzle generates an initial migration under `drizzle/`
- TypeScript passes

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts drizzle lib/db .env.example tests/unit/workspace-revisions.test.ts
git commit -m "Add persistent workspace schema"
```

---

### Task 2: Better Auth And Default Workspace

**Files:**
- Create: `lib/server/auth/config.ts`
- Create: `lib/server/auth/session.ts`
- Create: `lib/server/workspaces.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Create: `app/api/workspace/route.ts`
- Create: `components/auth/sign-in-panel.tsx`
- Modify: `app/page.tsx`
- Test: `tests/unit/workspaces.test.ts`
- Test: `tests/routes/workspace-route.test.ts`

**Interfaces:**
- Consumes: `db`, `workspaces`, `mapSnapshots`, `createRevision`
- Produces: `auth` Better Auth instance
- Produces: `getCurrentUserId(request: Request): Promise<string | null>`
- Produces: `requireCurrentUserId(request: Request): Promise<string>`
- Produces: `getOrCreateDefaultWorkspace(userId: string, now?: Date): Promise<{ workspace: WorkspaceRow; mapSnapshot: MapSnapshotRow }>`
- Produces: `GET /api/workspace` returning `WorkspaceResponse`

- [ ] **Step 1: Write workspace unit tests**

Create `tests/unit/workspaces.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { seedMapState } from "@/lib/map/seed-data";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const dbMock = vi.hoisted(() => ({
  current: createWorkspaceDbMock(),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => dbMock.current,
}));

describe("workspace helpers", () => {
  beforeEach(() => {
    dbMock.current = createWorkspaceDbMock();
  });

  test("creates a clean default workspace and map snapshot", async () => {
    const result = await getOrCreateDefaultWorkspace("user-1", new Date("2026-06-23T12:00:00.000Z"));

    expect(result.workspace.userId).toBe("user-1");
    expect(result.workspace.name).toBe("Apartment hunt");
    expect(result.workspace.listingLedgerRevision).toMatch(/^ledger-/);
    expect(result.mapSnapshot.mapState).toEqual(seedMapState);
    expect(result.mapSnapshot.revision).toMatch(/^map-/);
  });

  test("returns the same workspace on repeated calls", async () => {
    const first = await getOrCreateDefaultWorkspace("user-1");
    const second = await getOrCreateDefaultWorkspace("user-1");

    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.mapSnapshot.id).toBe(first.mapSnapshot.id);
  });
});

function createWorkspaceDbMock() {
  type WorkspaceValue = {
    id: string;
    userId: string;
    name: string;
    listingLedgerRevision: string;
    createdAt: Date;
    updatedAt: Date;
  };
  type SnapshotValue = {
    id: string;
    workspaceId: string;
    revision: string;
    mapState: typeof seedMapState;
    createdAt: Date;
    updatedAt: Date;
  };
  const workspacesByUser = new Map<string, WorkspaceValue>();
  const snapshotsByWorkspace = new Map<string, SnapshotValue>();

  return {
    insert() {
      return {
        values(value: WorkspaceValue | SnapshotValue) {
          return {
            onConflictDoUpdate() {
              return {
                async returning() {
                  if ("userId" in value) {
                    const existing = workspacesByUser.get(value.userId);
                    if (existing) {
                      return [existing];
                    }
                    workspacesByUser.set(value.userId, value);
                    return [value];
                  }

                  const existing = snapshotsByWorkspace.get(value.workspaceId);
                  if (existing) {
                    return [existing];
                  }
                  snapshotsByWorkspace.set(value.workspaceId, value);
                  return [value];
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return Array.from(snapshotsByWorkspace.values()).slice(0, 1);
                },
              };
            },
          };
        },
      };
    },
  };
}
```

- [ ] **Step 2: Run workspace unit tests to verify failure**

Run:

```bash
npm run test -- tests/unit/workspaces.test.ts
```

Expected: FAIL because `lib/server/workspaces.ts` does not exist.

- [ ] **Step 3: Implement Better Auth config**

Create `lib/server/auth/config.ts`:

```ts
import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { requireDb } from "@/lib/db/client";

export const auth = betterAuth({
  database: drizzleAdapter(requireDb(), {
    provider: "pg",
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
```

- [ ] **Step 4: Add Better Auth route**

Create `app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/server/auth/config";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 5: Implement session helpers**

Create `lib/server/auth/session.ts`:

```ts
import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/server/auth/config";

export async function getCurrentUserId(request?: Request) {
  const session = await auth.api.getSession({
    headers: request ? request.headers : await headers(),
  });

  return session?.user?.id ?? null;
}

export async function requireCurrentUserId(request?: Request) {
  const userId = await getCurrentUserId(request);

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}
```

- [ ] **Step 6: Implement workspace helper**

Create `lib/server/workspaces.ts`:

```ts
import "server-only";

import { eq } from "drizzle-orm";

import { mapSnapshots, workspaces } from "@/lib/db/schema";
import { createRevision } from "@/lib/db/workspace-revisions";
import { requireDb } from "@/lib/db/client";
import { seedMapState } from "@/lib/map/seed-data";

export async function getOrCreateDefaultWorkspace(userId: string, now = new Date()) {
  const database = requireDb();

  const workspaceId = `workspace-${crypto.randomUUID()}`;
  const listingLedgerRevision = createRevision("ledger");

  const [workspace] = await database
    .insert(workspaces)
    .values({
      id: workspaceId,
      userId,
      name: "Apartment hunt",
      listingLedgerRevision,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaces.userId,
      set: { updatedAt: now },
    })
    .returning();

  const existingSnapshots = await database
    .select()
    .from(mapSnapshots)
    .where(eq(mapSnapshots.workspaceId, workspace.id))
    .limit(1);

  if (existingSnapshots[0]) {
    return { workspace, mapSnapshot: existingSnapshots[0] };
  }

  const [mapSnapshot] = await database
    .insert(mapSnapshots)
    .values({
      id: `snapshot-${crypto.randomUUID()}`,
      workspaceId: workspace.id,
      revision: createRevision("map"),
      mapState: seedMapState,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mapSnapshots.workspaceId,
      set: { updatedAt: now },
    })
    .returning();

  return { workspace, mapSnapshot };
}
```

- [ ] **Step 7: Implement workspace route**

Create `app/api/workspace/route.ts`:

```ts
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { workspace, mapSnapshot } = await getOrCreateDefaultWorkspace(userId);

    return Response.json({
      workspace,
      mapSnapshot,
      listingLedgerRevision: workspace.listingLedgerRevision,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return Response.json({ ok: false, error: "Workspace load failed." }, { status: 500 });
  }
}
```

- [ ] **Step 8: Add sign-in panel**

Create `components/auth/sign-in-panel.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function SignInPanel() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-sm border border-border bg-card p-4">
        <h1 className="text-lg font-medium">SF Apartment Hunt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to sync maps, listings, and planning history across devices.
        </p>
        <Button className="mt-4 w-full" asChild>
          <a href="/api/auth/sign-in/google">Sign in with Google</a>
        </Button>
      </section>
    </main>
  );
}
```

- [ ] **Step 9: Update `app/page.tsx` for signed-in shell**

Change `app/page.tsx` to:

```tsx
import { ApartmentMapApp } from "@/components/apartment-map/apartment-map-app";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { getCurrentUserId } from "@/lib/server/auth/session";

export default async function Home() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return <SignInPanel />;
  }

  return <ApartmentMapApp />;
}
```

This is a temporary visual gate. Task 6 replaces the signed-in branch with `PersistentApartmentMapApp`.

- [ ] **Step 10: Write workspace route tests**

Create `tests/routes/workspace-route.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/workspace/route";
import { seedMapState } from "@/lib/map/seed-data";

const sessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));

vi.mock("@/lib/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth/session")>();

  return {
    ...actual,
    requireCurrentUserId: async () => {
      if (!sessionMock.userId) {
        throw new actual.UnauthorizedError();
      }
      return sessionMock.userId;
    },
  };
});

describe("GET /api/workspace", () => {
  beforeEach(() => {
    sessionMock.userId = null;
  });

  test("rejects signed-out users", async () => {
    const response = await GET(new Request("http://localhost/api/workspace"));

    expect(response.status).toBe(401);
  });

  test("creates and returns a default workspace for signed-in users", async () => {
    sessionMock.userId = "user-1";

    const response = await GET(new Request("http://localhost/api/workspace"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workspace.userId).toBe("user-1");
    expect(body.mapSnapshot.mapState).toEqual(seedMapState);
    expect(body.listingLedgerRevision).toMatch(/^ledger-/);
  });
});
```

- [ ] **Step 11: Run tests**

Run:

```bash
npm run test -- tests/unit/workspaces.test.ts tests/routes/workspace-route.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 12: Commit**

```bash
git add app/api/auth app/api/workspace app/page.tsx components/auth lib/server/auth lib/server/workspaces.ts tests/unit/workspaces.test.ts tests/routes/workspace-route.test.ts
git commit -m "Add Google auth workspace shell"
```

---

### Task 3: Workspace Route Contracts And CSRF Guard

**Files:**
- Create: `lib/server/security/origin.ts`
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Create: `lib/server/workspace-state.ts`
- Create: `app/api/workspace/map/route.ts`
- Create: `app/api/workspace/map/import/route.ts`
- Create: `app/api/workspace/map/export/route.ts`
- Create: `app/api/workspace/reset/route.ts`
- Test: `tests/unit/workspace-state.test.ts`
- Test: `tests/routes/workspace-map-route.test.ts`
- Test: `tests/routes/workspace-reset-route.test.ts`

**Interfaces:**
- Consumes: `getOrCreateDefaultWorkspace`, `requireCurrentUserId`, `workspaces`, `mapSnapshots`, `planningActions`
- Produces: `assertSameOriginRequest(request: Request): void`
- Produces: `updateWorkspaceMap(input): Promise<PutWorkspaceMapResult>`
- Produces: `importWorkspaceMap(input): Promise<ImportWorkspaceMapResult>`
- Produces: `resetWorkspace(input): Promise<WorkspaceResetResult>`
- Produces: `GET /api/workspace/map/export`, `PUT /api/workspace/map`, `POST /api/workspace/map/import`, `POST /api/workspace/reset`

- [ ] **Step 1: Add domain route types and schemas**

In `lib/domain/types.ts`, add:

```ts
export type WorkspaceRecord = {
  id: string;
  userId: string;
  name: string;
  listingLedgerRevision: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMapSnapshot = {
  id: string;
  workspaceId: string;
  revision: string;
  mapState: MapState;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceResponse = {
  workspace: WorkspaceRecord;
  mapSnapshot: WorkspaceMapSnapshot;
  listingLedgerRevision: string;
};

export type PutWorkspaceMapRequest = {
  expectedMapRevision: string;
  mapState: MapState;
};

export type PutWorkspaceMapResponse =
  | { ok: true; mapSnapshot: WorkspaceMapSnapshot; invalidatedActionIds: string[] }
  | { ok: false; error: "stale_map_revision"; currentMapRevision: string };

export type ImportWorkspaceMapRequest = PutWorkspaceMapRequest;
export type ImportWorkspaceMapResponse = PutWorkspaceMapResponse;

export type WorkspaceResetRequest = {
  expectedMapRevision: string;
  expectedListingLedgerRevision: string;
  confirmation: "reset";
};

export type WorkspaceResetResponse =
  | {
      ok: true;
      workspace: WorkspaceRecord;
      mapSnapshot: WorkspaceMapSnapshot;
      listingLedgerRevision: string;
    }
  | {
      ok: false;
      error: "stale_workspace_revision";
      currentMapRevision: string;
      currentListingLedgerRevision: string;
    };
```

In `lib/domain/schemas.ts`, add matching schemas using existing `mapStateSchema` and `idSchema`.

- [ ] **Step 2: Write CSRF guard tests inside route tests**

Create `tests/routes/workspace-map-route.test.ts` with the first failing same-origin case:

```ts
import { describe, expect, test, vi } from "vitest";

import { PUT } from "@/app/api/workspace/map/route";
import { seedMapState } from "@/lib/map/seed-data";

vi.mock("@/lib/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth/session")>();
  return {
    ...actual,
    requireCurrentUserId: async () => "user-1",
  };
});

describe("PUT /api/workspace/map", () => {
  test("rejects cross-site mutating requests", async () => {
    const response = await PUT(
      new Request("http://localhost/api/workspace/map", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({
          expectedMapRevision: "map-1",
          mapState: seedMapState,
        }),
      }),
    );

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run route test to verify failure**

Run:

```bash
npm run test -- tests/routes/workspace-map-route.test.ts
```

Expected: FAIL because `app/api/workspace/map/route.ts` does not exist.

- [ ] **Step 4: Implement same-origin guard**

Create `lib/server/security/origin.ts`:

```ts
export class ForbiddenOriginError extends Error {
  constructor() {
    super("Forbidden origin.");
  }
}

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const allowedOrigin = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ForbiddenOriginError();
  }

  if (origin && origin !== allowedOrigin) {
    throw new ForbiddenOriginError();
  }
}
```

- [ ] **Step 5: Implement workspace state helpers**

Create `lib/server/workspace-state.ts` with compare-and-set map writes and invalidation:

```ts
import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { createRevision } from "@/lib/db/workspace-revisions";
import { mapSnapshots, planningActions, workspaces } from "@/lib/db/schema";
import { requireDb } from "@/lib/db/client";
import type { MapState } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";

const mapActionKinds = ["mapProposal", "mapProposalItem", "targetEdit"] as const;
type WorkspaceDb = ReturnType<typeof requireDb>;
type WorkspaceTransaction = Parameters<Parameters<WorkspaceDb["transaction"]>[0]>[0];
type WorkspaceWriteClient = WorkspaceDb | WorkspaceTransaction;

export async function updateWorkspaceMap(input: {
  workspaceId: string;
  expectedMapRevision: string;
  mapState: MapState;
  now?: Date;
  staleActionError?: string;
}) {
  const database = requireDb();
  const now = input.now ?? new Date();
  return database.transaction(async (tx) => {
    const current = await tx.query.mapSnapshots.findFirst({
      where: eq(mapSnapshots.workspaceId, input.workspaceId),
    });

    if (!current || current.revision !== input.expectedMapRevision) {
      return {
        ok: false as const,
        error: "stale_map_revision" as const,
        currentMapRevision: current?.revision ?? "",
      };
    }

    const nextRevision = createRevision("map");
    const [snapshot] = await tx
      .update(mapSnapshots)
      .set({ mapState: input.mapState, revision: nextRevision, updatedAt: now })
      .where(eq(mapSnapshots.id, current.id))
      .returning();

    const invalidatedActionIds = await invalidatePendingMapActions(tx, {
      workspaceId: input.workspaceId,
      oldMapRevision: current.revision,
      error: input.staleActionError ?? "Map changed before this proposal was applied.",
      now,
    });

    return { ok: true as const, mapSnapshot: snapshot, invalidatedActionIds };
  });
}

export async function resetWorkspace(input: {
  workspaceId: string;
  expectedMapRevision: string;
  expectedListingLedgerRevision: string;
  now?: Date;
}) {
  const database = requireDb();
  const now = input.now ?? new Date();
  return database.transaction(async (tx) => {
    const workspace = await tx.query.workspaces.findFirst({
      where: eq(workspaces.id, input.workspaceId),
    });
    const snapshot = await tx.query.mapSnapshots.findFirst({
      where: eq(mapSnapshots.workspaceId, input.workspaceId),
    });

    if (
      !workspace ||
      !snapshot ||
      snapshot.revision !== input.expectedMapRevision ||
      workspace.listingLedgerRevision !== input.expectedListingLedgerRevision
    ) {
      return {
        ok: false as const,
        error: "stale_workspace_revision" as const,
        currentMapRevision: snapshot?.revision ?? "",
        currentListingLedgerRevision: workspace?.listingLedgerRevision ?? "",
      };
    }

    const nextMapRevision = createRevision("map");
    const nextLedgerRevision = createRevision("ledger");
    const [nextWorkspace] = await tx
      .update(workspaces)
      .set({ listingLedgerRevision: nextLedgerRevision, updatedAt: now })
      .where(eq(workspaces.id, input.workspaceId))
      .returning();
    const [nextSnapshot] = await tx
      .update(mapSnapshots)
      .set({ revision: nextMapRevision, mapState: seedMapState, updatedAt: now })
      .where(eq(mapSnapshots.id, snapshot.id))
      .returning();

    return {
      ok: true as const,
      workspace: nextWorkspace,
      mapSnapshot: nextSnapshot,
      listingLedgerRevision: nextWorkspace.listingLedgerRevision,
    };
  });
}

async function invalidatePendingMapActions(database: WorkspaceWriteClient, input: {
  workspaceId: string;
  oldMapRevision: string;
  error: string;
  now: Date;
}) {
  const pending = await database.query.planningActions.findMany({
    where: and(
      eq(planningActions.workspaceId, input.workspaceId),
      eq(planningActions.status, "pending"),
      inArray(planningActions.kind, mapActionKinds),
    ),
  });
  const matching = pending.filter((action) => {
    const target = action.target;
    return "mapRevision" in target && target.mapRevision === input.oldMapRevision;
  });

  if (matching.length === 0) {
    return [];
  }

  await database
    .update(planningActions)
    .set({
      status: "failed",
      failureKind: "permanent",
      error: input.error,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(planningActions.workspaceId, input.workspaceId),
        inArray(
          planningActions.id,
          matching.map((action) => action.id),
        ),
      ),
    );

  return matching.map((action) => action.id);
}
```

- [ ] **Step 6: Implement map route**

Create `app/api/workspace/map/route.ts`:

```ts
import { putWorkspaceMapRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";
import { updateWorkspaceMap } from "@/lib/server/workspace-state";

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = putWorkspaceMapRequestSchema.parse(await request.json());
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const result = await updateWorkspaceMap({
      workspaceId: workspace.id,
      expectedMapRevision: body.expectedMapRevision,
      mapState: body.mapState,
    });

    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: "Invalid workspace map request." }, { status: 400 });
  }
}
```

- [ ] **Step 7: Implement import/export/reset routes**

Create `app/api/workspace/map/import/route.ts` using the same body schema as `PUT /api/workspace/map`, but pass `staleActionError: "Map was replaced by JSON import."`.

Create `app/api/workspace/map/export/route.ts`:

```ts
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { mapSnapshot } = await getOrCreateDefaultWorkspace(userId);
    return Response.json(mapSnapshot.mapState);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: "Workspace export failed." }, { status: 500 });
  }
}
```

Create `app/api/workspace/reset/route.ts`:

```ts
import { workspaceResetRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";
import { resetWorkspace } from "@/lib/server/workspace-state";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = workspaceResetRequestSchema.parse(await request.json());
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const result = await resetWorkspace({
      workspaceId: workspace.id,
      expectedMapRevision: body.expectedMapRevision,
      expectedListingLedgerRevision: body.expectedListingLedgerRevision,
    });

    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: "Invalid workspace reset request." }, { status: 400 });
  }
}
```

- [ ] **Step 8: Expand route tests**

Replace `tests/routes/workspace-map-route.test.ts` with:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { PUT } from "@/app/api/workspace/map/route";
import { seedMapState } from "@/lib/map/seed-data";

const routeMocks = vi.hoisted(() => ({
  updateWorkspaceMap: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth/session")>();
  return {
    ...actual,
    requireCurrentUserId: async () => "user-1",
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async () => ({
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
    mapSnapshot: {
      id: "snapshot-1",
      workspaceId: "workspace-1",
      revision: "map-1",
      mapState: seedMapState,
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
  }),
}));

vi.mock("@/lib/server/workspace-state", () => ({
  updateWorkspaceMap: routeMocks.updateWorkspaceMap,
}));

describe("PUT /api/workspace/map", () => {
  beforeEach(() => {
    routeMocks.updateWorkspaceMap.mockReset();
    routeMocks.updateWorkspaceMap.mockResolvedValue({
      ok: true,
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-2",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      invalidatedActionIds: [],
    });
  });

  test("rejects cross-site mutating requests", async () => {
    const response = await PUT(createPutRequest({
      expectedMapRevision: "map-1",
      mapState: seedMapState,
    }, {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
  });

  test("returns 409 for stale map revisions", async () => {
    routeMocks.updateWorkspaceMap.mockResolvedValueOnce({
      ok: false,
      error: "stale_map_revision",
      currentMapRevision: "map-2",
    });

    const response = await PUT(createPutRequest({
      expectedMapRevision: "map-1",
      mapState: seedMapState,
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "stale_map_revision",
      currentMapRevision: "map-2",
    });
  });

  test("returns invalidated action ids after successful writes", async () => {
    routeMocks.updateWorkspaceMap.mockResolvedValueOnce({
      ok: true,
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-2",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      invalidatedActionIds: ["action-1"],
    });

    const response = await PUT(createPutRequest({
      expectedMapRevision: "map-1",
      mapState: seedMapState,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidatedActionIds).toEqual(["action-1"]);
  });
});

function createPutRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/workspace/map", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
```

Create `tests/routes/workspace-reset-route.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/workspace/reset/route";
import { seedMapState } from "@/lib/map/seed-data";

const routeMocks = vi.hoisted(() => ({
  resetWorkspace: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth/session")>();
  return {
    ...actual,
    requireCurrentUserId: async () => "user-1",
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async () => ({
    workspace: {
      id: "workspace-1",
      userId: "user-1",
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
    mapSnapshot: {
      id: "snapshot-1",
      workspaceId: "workspace-1",
      revision: "map-1",
      mapState: seedMapState,
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:00:00.000Z",
    },
  }),
}));

vi.mock("@/lib/server/workspace-state", () => ({
  resetWorkspace: routeMocks.resetWorkspace,
}));

describe("POST /api/workspace/reset", () => {
  beforeEach(() => {
    routeMocks.resetWorkspace.mockReset();
    routeMocks.resetWorkspace.mockResolvedValue({
      ok: true,
      workspace: {
        id: "workspace-1",
        userId: "user-1",
        name: "Apartment hunt",
        listingLedgerRevision: "ledger-2",
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      mapSnapshot: {
        id: "snapshot-1",
        workspaceId: "workspace-1",
        revision: "map-2",
        mapState: seedMapState,
        createdAt: "2026-06-23T12:00:00.000Z",
        updatedAt: "2026-06-23T12:01:00.000Z",
      },
      listingLedgerRevision: "ledger-2",
    });
  });

  test("requires reset confirmation", async () => {
    const response = await POST(createPostRequest({
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-1",
      confirmation: "delete",
    }));

    expect(response.status).toBe(400);
  });

  test("returns fresh revisions after reset", async () => {
    const response = await POST(createPostRequest({
      expectedMapRevision: "map-1",
      expectedListingLedgerRevision: "ledger-1",
      confirmation: "reset",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mapSnapshot.revision).toBe("map-2");
    expect(body.listingLedgerRevision).toBe("ledger-2");
  });
});

function createPostRequest(body: unknown) {
  return new Request("http://localhost/api/workspace/reset", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 9: Run tests**

Run:

```bash
npm run test -- tests/routes/workspace-map-route.test.ts tests/routes/workspace-reset-route.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 10: Commit**

```bash
git add lib/domain lib/server/security lib/server/workspace-state.ts app/api/workspace/map app/api/workspace/reset tests/routes/workspace-map-route.test.ts tests/routes/workspace-reset-route.test.ts
git commit -m "Add revisioned workspace map routes"
```

---

### Task 4: DB Listing Ledger And Geocode Cache Routes

**Files:**
- Create: `lib/server/listing-leads-db.ts`
- Create: `app/api/workspace/listings/route.ts`
- Create: `app/api/workspace/listings/[id]/route.ts`
- Create: `app/api/workspace/geocode-cache/route.ts`
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/listing-leads-db.test.ts`
- Test: `tests/routes/workspace-listings-route.test.ts`
- Test: `tests/routes/workspace-geocode-cache-route.test.ts`

**Interfaces:**
- Produces: `listWorkspaceListingLeads(workspaceId: string): Promise<ListingsResponse>`
- Produces: `updateWorkspaceListingStatus(input): Promise<PatchListingResponse>`
- Produces: `upsertWorkspaceGeocodeResult(input): Promise<PostGeocodeCacheResponse>`
- Produces: `GET /api/workspace/listings`
- Produces: `PATCH /api/workspace/listings/[id]`
- Produces: `POST /api/workspace/geocode-cache`

- [ ] **Step 1: Add route schemas**

Add to `lib/domain/types.ts`:

```ts
export type ListingsResponse = {
  leads: ListingLead[];
  listingLedgerRevision: string;
};

export type PatchListingRequest = {
  expectedListingLedgerRevision: string;
  status: "saved" | "dismissed";
};

export type PatchListingResponse =
  | { ok: true; lead: ListingLead; listingLedgerRevision: string }
  | {
      ok: false;
      error: "stale_listing_ledger_revision";
      currentListingLedgerRevision: string;
    }
  | { ok: false; error: "listing_not_found" };

export type PostGeocodeCacheRequest = {
  expectedListingLedgerRevision: string;
  canonicalUrl: string;
  queryHash: string;
  query: string;
  result: {
    coordinates: Coordinate | null;
    geocodeQuery: string | null;
    geocodeStatus: ListingCandidate["geocodeStatus"];
    locationConfidence: ListingCandidate["locationConfidence"];
    markerPrecision: ListingCandidate["markerPrecision"];
    locationText: string | null;
    neighborhoodGuess: string;
  };
};

export type PostGeocodeCacheResponse =
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
```

Add matching schemas in `lib/domain/schemas.ts`.

- [ ] **Step 2: Write listing DB unit tests**

Create `tests/unit/listing-leads-db.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { updateWorkspaceListingStatus, upsertWorkspaceGeocodeResult } from "@/lib/server/listing-leads-db";

describe("DB listing leads", () => {
  beforeEach(() => {
    // Initialize a lightweight DB mock with workspace revision "ledger-1" and one lead.
  });

  test("rejects stale listing status updates", async () => {
    const result = await updateWorkspaceListingStatus({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-stale",
      status: "saved",
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: "stale_listing_ledger_revision",
      currentListingLedgerRevision: "ledger-1",
    });
  });

  test("geocode writes update cache and listing candidate together", async () => {
    const result = await upsertWorkspaceGeocodeResult({
      workspaceId: "workspace-1",
      canonicalUrl: "https://example.com/listing",
      expectedListingLedgerRevision: "ledger-1",
      queryHash: "query-hash-1",
      query: "123 Main St San Francisco CA",
      result: {
        coordinates: [-122.42, 37.77],
        geocodeQuery: "123 Main St San Francisco CA",
        geocodeStatus: "geocoded_exact",
        locationConfidence: "high",
        markerPrecision: "exact",
        locationText: "123 Main St",
        neighborhoodGuess: "Mission",
      },
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lead.candidate.coordinates).toEqual([-122.42, 37.77]);
      expect(result.cacheEntry.queryHash).toBe("query-hash-1");
      expect(result.listingLedgerRevision).not.toBe("ledger-1");
    }
  });
});
```

- [ ] **Step 3: Run unit tests to verify failure**

Run:

```bash
npm run test -- tests/unit/listing-leads-db.test.ts
```

Expected: FAIL because `listing-leads-db.ts` does not exist.

- [ ] **Step 4: Implement `lib/server/listing-leads-db.ts`**

Implement with these signatures:

```ts
export async function listWorkspaceListingLeads(workspaceId: string): Promise<ListingsResponse>;

export async function updateWorkspaceListingStatus(input: {
  workspaceId: string;
  canonicalUrl: string;
  expectedListingLedgerRevision: string;
  status: "saved" | "dismissed";
  now?: Date;
}): Promise<PatchListingResponse>;

export async function upsertWorkspaceGeocodeResult(input: {
  workspaceId: string;
  canonicalUrl: string;
  expectedListingLedgerRevision: string;
  queryHash: string;
  query: string;
  result: PostGeocodeCacheRequest["result"];
  now?: Date;
}): Promise<PostGeocodeCacheResponse>;
```

Implementation requirements:

- Load workspace by `workspaceId`.
- Return stale response when `workspace.listingLedgerRevision !== expectedListingLedgerRevision`.
- Update `workspace.listingLedgerRevision` using `createRevision("ledger")` in the same operation as lead/cache mutation.
- For status update, preserve `candidate` and timestamps except `updatedAt`.
- For geocode update, upsert `geocode_cache_entry` on `(workspaceId, queryHash)` and update the matching `listing_lead.candidate`.
- Return `listing_not_found` if the lead is absent.

- [ ] **Step 5: Implement listing routes**

Create `app/api/workspace/listings/route.ts`:

```ts
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { listWorkspaceListingLeads } from "@/lib/server/listing-leads-db";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    return Response.json(await listWorkspaceListingLeads(workspace.id));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: "Listing load failed." }, { status: 500 });
  }
}
```

Create `app/api/workspace/listings/[id]/route.ts` with same-origin guard, schema validation, and `updateWorkspaceListingStatus`.

Create `app/api/workspace/geocode-cache/route.ts` with same-origin guard, schema validation, and `upsertWorkspaceGeocodeResult`.

- [ ] **Step 6: Write route tests**

Create `tests/routes/workspace-listings-route.test.ts` covering:

- signed-out `GET` returns 401
- signed-in `GET` returns leads and `listingLedgerRevision`
- stale `PATCH` returns 409
- successful `PATCH` returns updated lead and new revision

Create `tests/routes/workspace-geocode-cache-route.test.ts` covering:

- cross-site request returns 403
- stale revision returns 409
- successful write returns updated lead, cache entry, and new revision
- absent listing returns 404

- [ ] **Step 7: Run tests**

Run:

```bash
npm run test -- tests/unit/listing-leads-db.test.ts tests/routes/workspace-listings-route.test.ts tests/routes/workspace-geocode-cache-route.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit**

```bash
git add lib/domain lib/server/listing-leads-db.ts app/api/workspace/listings app/api/workspace/geocode-cache tests/unit/listing-leads-db.test.ts tests/routes/workspace-listings-route.test.ts tests/routes/workspace-geocode-cache-route.test.ts
git commit -m "Add DB listing ledger routes"
```

---

### Task 5: DB Planning Store

**Files:**
- Modify: `lib/server/planning/store.ts`
- Create: `lib/server/planning/store-db.ts`
- Modify: `app/api/ai/planning-chat/route.ts`
- Modify: `app/api/planning/actions/execute/route.ts`
- Modify: `app/api/planning/reset/route.ts`
- Test: `tests/unit/planning-store-db.test.ts`
- Test: `tests/routes/planning-chat-route.test.ts`
- Test: `tests/routes/planning-action-execute-route.test.ts`
- Test: `tests/routes/planning-reset-route.test.ts`

**Interfaces:**
- Consumes: Drizzle planning tables, workspace rows, map snapshots, listing leads
- Produces: `createDbPlanningStore(workspaceId: string): PlanningStore`
- Produces: signed-in planning chat/action/reset routes that use workspace ownership
- Preserves: existing installation-secret behavior for unsigned/dev route tests during transition

- [ ] **Step 1: Extend planning store factory**

Modify `lib/server/planning/store.ts`:

```ts
import { createDbPlanningStore } from "@/lib/server/planning/store-db";

export function getPlanningStoreForWorkspace(workspaceId: string): PlanningStore {
  return createDbPlanningStore(workspaceId);
}
```

Keep `getPlanningStore()` unchanged for unsigned/dev mode.

- [ ] **Step 2: Write DB planning store tests**

Create `tests/unit/planning-store-db.test.ts` covering:

```ts
test("creates workspace-owned threads and messages", async () => {
  const store = createDbPlanningStore("workspace-1");
  const created = await store.createThread({
    clientInstallationId: "workspace-1",
    clientInstallationSecretHash: "unused",
    initialMapState: seedMapState,
    now: "2026-06-23T12:00:00.000Z",
  });

  expect(created.ok).toBe(true);
  if (created.ok) {
    await store.appendMessage({
      threadId: created.thread.id,
      role: "user",
      parts: [{ type: "text", text: "Find listings" }],
      now: "2026-06-23T12:00:01.000Z",
    });
    const messages = await store.listRecentMessages(created.thread.id, 10);
    expect(messages).toHaveLength(1);
  }
});

test("rejects action ownership from a different workspace", async () => {
  const store = createDbPlanningStore("workspace-1");
  const otherStore = createDbPlanningStore("workspace-2");
  // Create thread/action in workspace-1, verify workspace-2 cannot load/execute it.
});

test("idempotency keys are unique per action", async () => {
  // claim same action/key twice -> first claimed, second in_progress or completed.
});
```

- [ ] **Step 3: Run DB planning tests to verify failure**

Run:

```bash
npm run test -- tests/unit/planning-store-db.test.ts
```

Expected: FAIL because `store-db.ts` does not exist.

- [ ] **Step 4: Implement `lib/server/planning/store-db.ts`**

Implement the full `PlanningStore` interface using Drizzle tables:

- `createThread` inserts `planning_thread`, creates or uses workspace `map_snapshot`, and returns `listingLedgerRevision`.
- `appendMessage` inserts `planning_message` with `workspaceId`.
- `createAction` inserts `planning_action` with `workspaceId`.
- `verifyThreadOwnership` ignores installation secret and returns true only when the thread exists in this store's workspace.
- `updateAction` updates only rows in this workspace.
- `claimActionExecution` uses `unique(actionId, idempotencyKey)`.
- `getMapSnapshot` returns the workspace map snapshot.
- `updateMapSnapshot` delegates to `updateWorkspaceMap`.
- `getListingLead`, `getListingLedgerRevision`, and `updateListingLeadStatus` delegate to listing DB helpers.
- `resetInstallation` should return `{ ok: true }` after deleting planning rows for the workspace; it must not check installation secrets in signed-in mode.

Use existing `createMemoryPlanningStore` behavior as the reference for hashing, action terminal semantics, and execution response assembly.

- [ ] **Step 5: Update planning routes for signed-in branch**

In `app/api/ai/planning-chat/route.ts`:

- Try `getCurrentUserId(request)`.
- If signed in, load workspace and use `getPlanningStoreForWorkspace(workspace.id)`.
- Do not require `x-sf-apt-installation-secret` in signed-in branch.
- Still require OpenAI bearer key.
- Keep old installation-secret branch for unsigned/dev mode.
- Error copy for signed-in ownership should say `Planning thread is not owned by this workspace.`

In `app/api/planning/actions/execute/route.ts`:

- Signed-in branch verifies action/thread through DB planning store workspace ownership.
- Unsigned branch keeps installation-secret logic.

In `app/api/planning/reset/route.ts`:

- Signed-in branch resets workspace planning rows.
- Unsigned branch keeps installation reset logic.

- [ ] **Step 6: Update route tests**

Add tests to existing route suites:

- signed-in planning chat does not require installation secret
- signed-in planning chat writes workspace-owned thread/message/action rows
- signed-in action execution rejects actions from a different workspace
- signed-in planning reset clears workspace planning rows
- unsigned route behavior still requires installation secret

- [ ] **Step 7: Run tests**

Run:

```bash
npm run test -- tests/unit/planning-store-db.test.ts tests/routes/planning-chat-route.test.ts tests/routes/planning-action-execute-route.test.ts tests/routes/planning-reset-route.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit**

```bash
git add lib/server/planning app/api/ai/planning-chat app/api/planning tests/unit/planning-store-db.test.ts tests/routes/planning-chat-route.test.ts tests/routes/planning-action-execute-route.test.ts tests/routes/planning-reset-route.test.ts
git commit -m "Add workspace-backed planning store"
```

---

### Task 6: Signed-In Persistent App Client

**Files:**
- Create: `components/apartment-map/persistence-types.ts`
- Create: `components/apartment-map/persistent-apartment-map-app.tsx`
- Modify: `app/page.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/planning-chat-panel.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Test: `tests/e2e/persistent-workspace.spec.ts`

**Interfaces:**
- Consumes: workspace API routes from Tasks 2-5
- Produces: signed-in app that hydrates map/listings/planning state from DB routes
- Preserves: unsigned local `ApartmentMapApp`

- [ ] **Step 1: Create persistence client types**

Create `components/apartment-map/persistence-types.ts`:

```ts
import type {
  ListingLead,
  MapState,
  WorkspaceMapSnapshot,
  WorkspaceRecord,
} from "@/lib/domain/types";

export type PersistentWorkspaceInitialState = {
  workspace: WorkspaceRecord;
  mapSnapshot: WorkspaceMapSnapshot;
  listingLeads: ListingLead[];
  listingLedgerRevision: string;
};
```

- [ ] **Step 2: Create client-state route**

Create `app/api/workspace/client-state/route.ts`:

```ts
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { listWorkspaceListingLeads } from "@/lib/server/listing-leads-db";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export async function GET(request: Request) {
  try {
    const userId = await requireCurrentUserId(request);
    const { workspace, mapSnapshot } = await getOrCreateDefaultWorkspace(userId);
    const listings = await listWorkspaceListingLeads(workspace.id);

    return Response.json({
      workspace,
      mapSnapshot,
      listingLeads: listings.leads,
      listingLedgerRevision: listings.listingLedgerRevision,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: false, error: "Workspace client state failed." }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create `PersistentApartmentMapApp`**

Create `components/apartment-map/persistent-apartment-map-app.tsx` with this state contract:

- initial map state comes from `initialState.mapSnapshot.mapState`
- `mapRevision` state comes from `initialState.mapSnapshot.revision`
- `listingLedgerRevision` state comes from `initialState.listingLedgerRevision`
- `listingLeads` state comes from `initialState.listingLeads`
- `updateMapState(nextState)` calls `PUT /api/workspace/map` with `expectedMapRevision`
- successful map writes update local map revision and remove/disable invalidated action ids in planning chat cache
- stale map writes show a compact sidebar error and reload workspace state
- JSON import calls `POST /api/workspace/map/import`
- reset calls `POST /api/workspace/reset`
- listing status/geocode changes call DB routes and update ledger revision
- OpenAI key remains browser-local through existing key storage

Extract only shared pieces that both containers call directly: map viewport rendering, sidebar shell rendering, and proposal review rendering. Keep the existing map/sidebar layout and visual density unchanged.

- [ ] **Step 4: Update planning chat panel props**

Modify `components/apartment-map/planning-chat-panel.tsx` to accept:

```ts
ownershipMode:
  | { kind: "local" }
  | {
      kind: "workspace";
      mapRevision: string;
      listingLedgerRevision: string;
      invalidatedActionIds: string[];
    };
```

Behavior:

- local mode keeps installation header behavior
- workspace mode omits installation secret header and sends workspace revisions
- when `invalidatedActionIds` changes, update cached action cards to `failed` with permanent failure in the local chat cache

- [ ] **Step 5: Update `app/page.tsx` to render persistent app**

Change signed-in branch:

```tsx
import { PersistentApartmentMapApp } from "@/components/apartment-map/persistent-apartment-map-app";
import { listWorkspaceListingLeads } from "@/lib/server/listing-leads-db";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

export default async function Home() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return <ApartmentMapApp />;
  }

  const { workspace, mapSnapshot } = await getOrCreateDefaultWorkspace(userId);
  const listings = await listWorkspaceListingLeads(workspace.id);

  return (
    <PersistentApartmentMapApp
      initialState={{
        workspace,
        mapSnapshot,
        listingLeads: listings.leads,
        listingLedgerRevision: listings.listingLedgerRevision,
      }}
    />
  );
}
```

Signed-out users render the existing local `ApartmentMapApp` in this implementation. Do not force sign-in in this branch.

- [ ] **Step 6: Write E2E persistent workspace test**

Create `tests/e2e/persistent-workspace.spec.ts` with mocked workspace routes rather than real Google OAuth:

```ts
import { expect, test } from "@playwright/test";
import { samplePlanningMapState, seedMapState } from "../../lib/map/seed-data";

test("signed-in workspace map import persists after reload", async ({ page }) => {
  let mapState = seedMapState;
  let mapRevision = "map-1";

  await page.route("**/api/workspace/client-state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: "workspace-1",
          userId: "user-1",
          name: "Apartment hunt",
          listingLedgerRevision: "ledger-1",
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: mapRevision,
          mapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:00.000Z",
        },
        listingLeads: [],
        listingLedgerRevision: "ledger-1",
      }),
    });
  });

  await page.route("**/api/workspace/map/import", async (route) => {
    const body = route.request().postDataJSON() as { expectedMapRevision: string; mapState: typeof seedMapState };
    expect(body.expectedMapRevision).toBe(mapRevision);
    mapState = body.mapState;
    mapRevision = "map-2";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        mapSnapshot: {
          id: "snapshot-1",
          workspaceId: "workspace-1",
          revision: mapRevision,
          mapState,
          createdAt: "2026-06-23T12:00:00.000Z",
          updatedAt: "2026-06-23T12:00:01.000Z",
        },
        invalidatedActionIds: [],
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator(".target-anchor-marker")).toHaveCount(0);

  await page.getByLabel("Import map JSON file").setInputFiles({
    name: "sample-map.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(samplePlanningMapState)),
  });

  await expect(page.getByText("Ready to import sample-map.json.")).toBeVisible();
  await page.getByRole("button", { name: "Replace current map" }).click();
  await expect(page.getByText("Imported sample-map.json.")).toBeVisible();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(3);

  await page.reload();
  await expect(page.locator(".target-anchor-marker")).toHaveCount(3);
});
```

- [ ] **Step 7: Run E2E and route tests**

Run:

```bash
npm run test -- tests/routes/workspace-route.test.ts tests/routes/workspace-map-route.test.ts tests/routes/workspace-listings-route.test.ts tests/routes/workspace-geocode-cache-route.test.ts
npx playwright test tests/e2e/persistent-workspace.spec.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx app/api/workspace/client-state components/apartment-map tests/e2e/persistent-workspace.spec.ts
git commit -m "Connect signed-in workspace app"
```

---

### Task 7: Final Verification And Setup Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified persistent account implementation ready for review

- [ ] **Step 1: Run full unit and route suite**

Run:

```bash
npm run test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run lint and typecheck**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both pass.

- [ ] **Step 3: Run E2E suite**

Run:

```bash
npx playwright test
```

Expected: all Playwright tests pass.

- [ ] **Step 4: Run production build**

Run:

```bash
npx next build --webpack
```

Expected: production build passes. If `npm run build` fails because Turbopack rejects a temporary worktree `node_modules` symlink, record that separately and keep the webpack build result.

- [ ] **Step 5: Manual smoke checklist**

Run `npm run dev -- --hostname 127.0.0.1` and verify:

- signed-out local mode still loads
- signed-in branch can load a default workspace when auth is mocked or configured
- map edit writes return a new revision
- JSON import updates the DB map and invalidates stale map actions
- listing save/dismiss persists and updates the ledger revision
- planning chat works without installation secret for signed-in users
- OpenAI key is not written to DB

- [ ] **Step 6: Document persistent account setup**

Add this section to `README.md`:

````markdown
## Persistent Account Setup

Signed-in persistence uses Better Auth, Google OAuth, Drizzle, and Neon Postgres.

Required environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

After changing the Drizzle schema, generate and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

The signed-in app stores workspace map state, listing leads, geocode cache entries, and planning chat state in Postgres. The OpenAI API key remains browser-local.
````

- [ ] **Step 7: Commit setup docs**

```bash
git add README.md
git commit -m "Document persistent workspace setup"
```
