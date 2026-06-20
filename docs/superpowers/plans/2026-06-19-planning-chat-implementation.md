# Planning Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split assistant/listing/proposal UX with a unified planning chat that creates reviewable action cards for map proposals and listing leads.

**Architecture:** Add typed planning-chat domain contracts, a server-side planning store, and a unified `POST /api/ai/planning-chat` route that reuses existing map-assistant and listing-search behavior. Add `POST /api/planning/actions/execute` so map/listing card actions mutate server-owned planning state first, then return updated map/listing state for the client cache.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Zod 4 schemas, OpenAI Responses API, existing `@upstash/redis` dependency for production persistence, in-memory planning store for test/dev fallback, Vitest, Playwright.

## Global Constraints

- This repo runs Next.js 16 with the App Router, React 19, and Server Components; before editing Next.js route/component code, read the relevant guide in `node_modules/next/dist/docs/`.
- Validate request bodies, external responses, and AI output with Zod or strict JSON schemas.
- OpenAI keys are BYO; forward as bearer tokens with `store: false`; never store, log, or echo them server-side.
- Google geocoding requires signed, short-lived, query-hash-bound nonces and SF-bounds filtering.
- AI proposes; the server disposes. Re-parse and validate proposals before applying them.
- Domain coordinates are `[lng, lat]`; Leaflet uses `[lat, lng]`.
- Use `lib/storage/` wrappers only; do not touch `window.localStorage` directly in feature code.
- Browser storage keys are namespaced as `sf-apt-hunt:...`.
- Use Tailwind CSS 4 and `cn()` from `lib/utils`; preserve mobile usability and the `lg:` map/sidebar split.
- Every mutation requires an explicit user action click in v1.
- Planning chat v1 uses request/response, not token streaming.
- The planning store is canonical for chat threads, action records, listing lifecycle, preference memory, and the active map snapshot once migration succeeds.
- Browser storage remains a bootstrap source and cache only after server migration succeeds.
- `clientInstallationId` plus `clientInstallationSecret` is bearer-style anonymous ownership; store only a hash of the secret server-side.
- Do not rely on OpenAI `previous_response_id` while sending `store: false`; build context from app state each turn.

---

## File Structure

- Modify `lib/domain/types.ts`: expand `ListingLeadStatus` to include `saved` and `dismissed`; add planning chat domain types in the same domain file used by the current app.
- Modify `lib/domain/schemas.ts`: add planning chat schemas, planning action schemas, and listing status changes.
- Create `lib/server/planning/installation.ts`: installation secret hashing and verification helpers.
- Create `lib/server/planning/store.ts`: `PlanningStore` interface and factory.
- Create `lib/server/planning/memory-store.ts`: test/dev store implementing `PlanningStore`.
- Create `lib/server/planning/redis-store.ts`: production store using `@upstash/redis`.
- Create `lib/server/planning/actions.ts`: deterministic action execution helpers for map proposals and listing save/dismiss.
- Create `lib/server/planning/context.ts`: builds compact model context from map snapshot, preference memory, thread messages, and actions.
- Create `lib/server/planning/chat.ts`: request orchestration and conversion from legacy map/listing helpers into chat parts.
- Modify `app/api/ai/map-assistant/route.ts`: move the existing route body into a reusable map-assistant service and keep the route as a thin wrapper until cleanup.
- Modify `app/api/ai/listing-search/route.ts`: move the existing route body into a reusable listing-search service and keep the route as a thin wrapper until cleanup.
- Create `app/api/ai/planning-chat/route.ts`: unified planning chat endpoint.
- Create `app/api/planning/actions/execute/route.ts`: action execution endpoint.
- Create `app/api/planning/reset/route.ts`: server-side planning state reset endpoint for the current installation.
- Create `lib/storage/planning-chat-storage.ts`: local cached chat thread, installation id/secret, and map/listing revision cache wrappers.
- Create `components/apartment-map/planning-chat-panel.tsx`: chat timeline, composer, compact context, action cards.
- Modify `components/apartment-map/sidebar.tsx`: replace `AssistantPanel`, `ListingResults`, and `ProposalReviewDialog` with `PlanningChatPanel` once action cards are functional.
- Modify `components/apartment-map/apartment-map-app.tsx`: wire planning chat actions into map state, listing leads, geocode flow, reset, and undo.
- Delete `components/apartment-map/listing-results.tsx` during cleanup after listing cards render inside `PlanningChatPanel`.
- Test `tests/unit/planning-chat-schemas.test.ts`.
- Test `tests/unit/planning-store.test.ts`.
- Test `tests/unit/planning-actions.test.ts`.
- Test `tests/unit/listing-ledger-storage.test.ts`.
- Test `tests/routes/planning-chat-route.test.ts`.
- Test `tests/routes/planning-action-execute-route.test.ts`.
- Test `tests/routes/planning-reset-route.test.ts`.
- Test `tests/unit/planning-chat-storage.test.ts`.
- Test `tests/e2e/apartment-map.spec.ts`.

---

### Task 1: Planning Chat Domain Contracts

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Create: `tests/unit/planning-chat-schemas.test.ts`

**Interfaces:**
- Consumes: existing `MapState`, `MapPatchProposal`, `ResearchSummary`, `ListingLead`, `ListingDisplayCandidate`, `SelectedMapEntity`-compatible shape.
- Produces: `PlanningChatRequest`, `PlanningChatResponse`, `PlanningChatPart`, `PlanningActionRecord`, `PlanningActionTarget`, `ExecutePlanningActionRequest`, `ExecutePlanningActionResponse`, `MapSnapshot`, and matching Zod schemas.

- [ ] **Step 1: Read Next/domain context**

Run:

```bash
sed -n '1,220p' node_modules/next/dist/docs/app/api-reference/file-conventions/route.mdx
sed -n '1,280p' lib/domain/types.ts
sed -n '1,460p' lib/domain/schemas.ts
```

Expected: route handler docs are available locally; existing domain shapes are understood before edits.

- [ ] **Step 2: Write failing schema tests**

Add `tests/unit/planning-chat-schemas.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  executePlanningActionRequestSchema,
  listingLeadStatusSchema,
  planningActionRecordSchema,
  planningChatRequestSchema,
  planningChatResponseSchema,
} from "@/lib/domain/schemas";
import { seedMapState } from "@/lib/map/seed-data";

const now = "2026-06-19T12:00:00.000Z";

describe("planning chat schemas", () => {
  test("accepts saved and dismissed listing statuses", () => {
    expect(listingLeadStatusSchema.parse("saved")).toBe("saved");
    expect(listingLeadStatusSchema.parse("dismissed")).toBe("dismissed");
  });

  test("requires action records to bind to a stored target", () => {
    const action = planningActionRecordSchema.parse({
      id: "action-1",
      threadId: "thread-1",
      messageId: "message-1",
      partIndex: 1,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: "message-1",
        partIndex: 1,
        proposalHash: "hash-1",
        allowedOperationIndexes: [0],
        mapRevision: "map-rev-1",
      },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    expect(action.target.kind).toBe("mapProposal");
  });

  test("rejects listing action payloads that try to provide a canonical URL", () => {
    const result = executePlanningActionRequestSchema.safeParse({
      threadId: "thread-1",
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payload: {
        kind: "listingSave",
        canonicalUrl: "https://example.com/listing/1",
        expectedListingLedgerRevision: "ledger-rev-1",
      },
    });

    expect(result.success).toBe(false);
  });

  test("accepts planning chat request and response contracts", () => {
    const request = planningChatRequestSchema.parse({
      threadId: null,
      clientInstallationId: "install-1",
      clientInstallationSecret: "secret-1",
      message: "Add pins for Solidcore in SF",
      mapState: seedMapState,
      mapRevision: null,
      listingLedgerRevision: null,
      selectedEntity: null,
      visibleContext: null,
    });

    expect(request.message).toContain("Solidcore");

    const response = planningChatResponseSchema.parse({
      thread: {
        id: "thread-1",
        clientInstallationId: "install-1",
        createdAt: now,
        updatedAt: now,
        title: "Apartment planning",
        summary: "",
      },
      userMessage: {
        id: "message-user-1",
        threadId: "thread-1",
        role: "user",
        parts: [{ type: "text", text: "Add pins for Solidcore in SF" }],
        createdAt: now,
      },
      assistantMessage: {
        id: "message-assistant-1",
        threadId: "thread-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I can help with that." },
          {
            type: "listingResults",
            resultSetId: "result-set-1",
            listings: [],
            sourceSummary: "No matching listings returned.",
            caveats: [],
            geocodeAuthorization: null,
          },
        ],
        createdAt: now,
      },
      contextSummary: {
        budget: null,
        beds: null,
        timing: null,
        furnished: null,
        shortTerm: null,
        positiveAnchors: [],
        avoidAnchors: [],
        selectedZones: [],
        sourceStrictness: null,
      },
      actionRecords: [],
      mapSnapshot: {
        id: "snapshot-1",
        threadId: "thread-1",
        clientInstallationId: "install-1",
        mapState: seedMapState,
        revision: "map-rev-1",
        createdAt: now,
        updatedAt: now,
      },
      listingLedgerRevision: "ledger-rev-1",
    });

    expect(response.assistantMessage.parts[1]).toMatchObject({
      type: "listingResults",
      geocodeAuthorization: null,
    });
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/planning-chat-schemas.test.ts
```

Expected: FAIL because the planning chat schemas do not exist and listing statuses only allow `new | seen`.

- [ ] **Step 4: Add domain types and schemas**

Implement:

```ts
export type ListingLeadStatus = "new" | "seen" | "saved" | "dismissed";

export type PlanningMessageRole = "user" | "assistant";
export type PlanningActionStatus = "pending" | "applied" | "dismissed" | "failed";
export type PlanningActionFailureKind = "retryable" | "permanent";

export type PlanningContextSummary = {
  budget: number | null;
  beds: ListingSearchFilters["beds"] | null;
  timing: string | null;
  furnished: boolean | null;
  shortTerm: boolean | null;
  positiveAnchors: string[];
  avoidAnchors: string[];
  selectedZones: string[];
  sourceStrictness: string | null;
};

export type MapSnapshot = {
  id: string;
  threadId: string;
  clientInstallationId: string;
  mapState: MapState;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanningListingCard = {
  lead: ListingLead;
  display: ListingDisplayCandidate;
  saveActionId: string;
  dismissActionId: string;
};

export type PlanningChatPart =
  | { type: "text"; text: string }
  | { type: "contextSummary"; context: PlanningContextSummary }
  | { type: "followUpQuestion"; question: string; missingInformation: string[] }
  | { type: "mapProposal"; actionId: string; proposal: MapPatchProposal; researchSummary: ResearchSummary | null }
  | { type: "listingResults"; resultSetId: string; listings: PlanningListingCard[]; sourceSummary: string; caveats: string[]; geocodeAuthorization: GeocodeAuthorization | null }
  | { type: "targetEditProposal"; actionId: string; proposal: MapPatchProposal }
  | { type: "error"; message: string };

export type PlanningMessage = {
  id: string;
  threadId: string;
  role: PlanningMessageRole;
  parts: PlanningChatPart[];
  createdAt: string;
};

export type PlanningThread = {
  id: string;
  clientInstallationId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  summary: string;
};
```

Add strict schemas for each type in `lib/domain/schemas.ts`. Use `.strict()` on request/response/action object schemas. Reuse existing `mapStateSchema`, `mapPatchProposalSchema`, `listingLeadSchema`, and `listingDisplayCandidateSchema` if present; otherwise add `listingDisplayCandidateSchema` matching `ListingDisplayCandidate`.

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/planning-chat-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/domain/types.ts lib/domain/schemas.ts tests/unit/planning-chat-schemas.test.ts
git commit -m "Add planning chat domain contracts"
```

---

### Task 2: Listing Ledger Lifecycle

**Files:**
- Modify: `lib/storage/listing-ledger-storage.ts`
- Modify: `tests/unit/listing-ledger-storage.test.ts`
- Modify: `lib/map/listing-planning-score.ts` if display status assumptions need updates.
- Modify: `tests/unit/listing-planning-score.test.ts` if display status tests need updates.

**Interfaces:**
- Consumes: `ListingLeadStatus = "new" | "seen" | "saved" | "dismissed"`.
- Produces: `saveListingLead(canonicalUrl, storage?)`, `dismissListingLead(canonicalUrl, storage?)`, and merge behavior that preserves saved/dismissed status on reappearing leads.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests to `tests/unit/listing-ledger-storage.test.ts`:

```ts
test("preserves saved status when a saved listing reappears", () => {
  const storage = createMemoryStorage();
  const first = mergeListingCandidatesIntoLedger({
    candidates: [createCandidate(1)],
    query: "first",
    now: "2026-06-19T12:00:00.000Z",
    storage,
  }).leads[0];

  const saved = saveListingLead(first.canonicalUrl, storage);
  expect(saved?.status).toBe("saved");

  const second = mergeListingCandidatesIntoLedger({
    candidates: [createCandidate(1, { title: "Updated listing" })],
    query: "second",
    now: "2026-06-20T12:00:00.000Z",
    storage,
  }).leads[0];

  expect(second.status).toBe("saved");
  expect(second.seenCount).toBe(2);
  expect(second.candidate.title).toBe("Updated listing");
});

test("preserves dismissed status and omits dismissed leads from merge results by default", () => {
  const storage = createMemoryStorage();
  const first = mergeListingCandidatesIntoLedger({
    candidates: [createCandidate(1)],
    query: "first",
    now: "2026-06-19T12:00:00.000Z",
    storage,
  }).leads[0];

  const dismissed = dismissListingLead(first.canonicalUrl, storage);
  expect(dismissed?.status).toBe("dismissed");

  const result = mergeListingCandidatesIntoLedger({
    candidates: [createCandidate(1, { title: "Updated listing" })],
    query: "second",
    now: "2026-06-20T12:00:00.000Z",
    storage,
  });

  expect(result.leads).toEqual([]);
  expect(loadListingLedger(storage)[first.canonicalUrl]?.status).toBe("dismissed");
  expect(loadListingLedger(storage)[first.canonicalUrl]?.seenCount).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/listing-ledger-storage.test.ts
```

Expected: FAIL because `saveListingLead` and `dismissListingLead` do not exist and merge overwrites status with `seen`.

- [ ] **Step 3: Implement lifecycle helpers**

Update merge behavior:

```ts
function statusForReappearingLead(existingStatus: ListingLeadStatus): ListingLeadStatus {
  if (existingStatus === "saved" || existingStatus === "dismissed") {
    return existingStatus;
  }

  return "seen";
}

export function saveListingLead(url: string, storage?: StorageLike) {
  return updateListingLeadStatus(url, "saved", storage);
}

export function dismissListingLead(url: string, storage?: StorageLike) {
  return updateListingLeadStatus(url, "dismissed", storage);
}

function updateListingLeadStatus(
  url: string,
  status: Extract<ListingLeadStatus, "saved" | "dismissed">,
  storage?: StorageLike,
) {
  const canonicalUrl = canonicalizeListingUrl(url);
  const ledger = loadListingLedger(storage);
  const existingLead = ledger[canonicalUrl];

  if (!existingLead) {
    return null;
  }

  const nextLead = {
    ...existingLead,
    status,
  };
  const nextLedger = {
    ...ledger,
    [canonicalUrl]: nextLead,
  };
  saveListingLedger(nextLedger, storage);
  return nextLead;
}
```

When merging candidates, push only non-dismissed leads into the returned `leads` list while still persisting dismissed reappearances.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/listing-ledger-storage.test.ts tests/unit/listing-planning-score.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/storage/listing-ledger-storage.ts tests/unit/listing-ledger-storage.test.ts lib/map/listing-planning-score.ts tests/unit/listing-planning-score.test.ts
git commit -m "Add listing lead lifecycle actions"
```

---

### Task 3: Planning Store And Ownership

**Files:**
- Create: `lib/server/planning/installation.ts`
- Create: `lib/server/planning/store.ts`
- Create: `lib/server/planning/memory-store.ts`
- Create: `lib/server/planning/redis-store.ts`
- Create: `tests/unit/planning-store.test.ts`

**Interfaces:**
- Consumes: planning chat domain types and schemas from Task 1.
- Produces: `getPlanningStore()`, `hashInstallationSecret(secret)`, `verifyInstallationSecret(secret, hash)`, and a `PlanningStore` interface used by route tasks.

- [ ] **Step 1: Write failing ownership/store tests**

Create `tests/unit/planning-store.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { seedMapState } from "@/lib/map/seed-data";
import { hashInstallationSecret, verifyInstallationSecret } from "@/lib/server/planning/installation";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";

describe("planning store", () => {
  test("hashes installation secrets without returning the raw secret", async () => {
    const hash = await hashInstallationSecret("secret-1");

    expect(hash).not.toBe("secret-1");
    await expect(verifyInstallationSecret("secret-1", hash)).resolves.toBe(true);
    await expect(verifyInstallationSecret("wrong", hash)).resolves.toBe(false);
  });

  test("creates a thread with a canonical map snapshot revision", async () => {
    const store = createMemoryPlanningStore();
    const result = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    expect(result.thread.clientInstallationId).toBe("install-1");
    expect(result.mapSnapshot.mapState).toEqual(seedMapState);
    expect(result.mapSnapshot.revision).toMatch(/^map-rev-/);
    expect(result.listingLedgerRevision).toMatch(/^ledger-rev-/);
  });

  test("rejects stale map snapshot updates", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now: "2026-06-19T12:00:00.000Z",
    });

    const result = await store.updateMapSnapshot({
      threadId: created.thread.id,
      expectedRevision: "wrong-revision",
      mapState: seedMapState,
      now: "2026-06-19T12:01:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("stale_map_revision");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/planning-store.test.ts
```

Expected: FAIL because planning store modules do not exist.

- [ ] **Step 3: Implement installation helpers**

`lib/server/planning/installation.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

export async function hashInstallationSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export async function verifyInstallationSecret(secret: string, expectedHash: string) {
  const actualHash = await hashInstallationSecret(secret);
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Implement store interface and memory store**

`lib/server/planning/store.ts` exports:

```ts
export type CreateThreadInput = {
  clientInstallationId: string;
  clientInstallationSecretHash: string;
  initialMapState: MapState;
  now: string;
};

export type UpdateMapSnapshotResult =
  | { ok: true; snapshot: MapSnapshot }
  | { ok: false; error: "thread_not_found" | "stale_map_revision" };

export type PlanningStore = {
  createThread(input: CreateThreadInput): Promise<{
    thread: PlanningThread;
    mapSnapshot: MapSnapshot;
    listingLedgerRevision: string;
  }>;
  getThread(threadId: string): Promise<PlanningThread | null>;
  getMapSnapshot(threadId: string): Promise<MapSnapshot | null>;
  updateMapSnapshot(input: {
    threadId: string;
    expectedRevision: string;
    mapState: MapState;
    now: string;
  }): Promise<UpdateMapSnapshotResult>;
};
```

Implement `createMemoryPlanningStore()` with `Map` collections, deterministic revision prefixes, and no module-level cross-test state unless `getPlanningStore()` is called.

- [ ] **Step 5: Add Redis store wrapper**

`lib/server/planning/redis-store.ts` should use `Redis.fromEnv()` and keys:

```ts
const planningKey = {
  thread: (threadId: string) => `sf-apt-hunt:planning:thread:${threadId}`,
  mapSnapshot: (threadId: string) => `sf-apt-hunt:planning:map-snapshot:${threadId}`,
  installation: (installationId: string) => `sf-apt-hunt:planning:installation:${installationId}`,
};
```

For revision-checked updates, use Redis `watch`/transaction if available in `@upstash/redis`; if not, perform a read-compare-write in v1 and document that production should move to a compare-and-set primitive before high-concurrency rollout.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/planning-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/server/planning/installation.ts lib/server/planning/store.ts lib/server/planning/memory-store.ts lib/server/planning/redis-store.ts tests/unit/planning-store.test.ts
git commit -m "Add planning store foundation"
```

---

### Task 4: Planning Action Execution

**Files:**
- Create: `lib/server/planning/actions.ts`
- Create: `app/api/planning/actions/execute/route.ts`
- Create: `tests/unit/planning-actions.test.ts`
- Create: `tests/routes/planning-action-execute-route.test.ts`
- Modify: `lib/server/planning/store.ts`
- Modify: `lib/server/planning/memory-store.ts`

**Interfaces:**
- Consumes: `PlanningStore`, `ExecutePlanningActionRequest`, stored action targets, `applyProposal`.
- Produces: `executePlanningAction(input)` and route `POST /api/planning/actions/execute`.

- [ ] **Step 1: Read route docs**

Run:

```bash
sed -n '1,220p' node_modules/next/dist/docs/app/api-reference/file-conventions/route.mdx
sed -n '1,180p' app/api/map/apply-proposal/route.ts
sed -n '1,240p' lib/map/proposals.ts
```

Expected: understand local route response conventions and proposal validation path.

- [ ] **Step 2: Write failing unit tests**

Create `tests/unit/planning-actions.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type { MapPatchProposal } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { hashInstallationSecret } from "@/lib/server/planning/installation";
import { executePlanningAction } from "@/lib/server/planning/actions";
import { createMemoryPlanningStore } from "@/lib/server/planning/memory-store";

const now = "2026-06-19T12:00:00.000Z";

describe("executePlanningAction", () => {
  test("applies a stored map proposal subset and advances the map revision", async () => {
    const store = createMemoryPlanningStore();
    const created = await store.createThread({
      clientInstallationId: "install-1",
      clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
      initialMapState: seedMapState,
      now,
    });
    const proposal: MapPatchProposal = {
      summary: "Add one target",
      confidence: "high",
      requiresUserReview: true,
      operations: [
        {
          type: "addTarget",
          target: {
            id: "target-test",
            name: "Test target",
            purpose: "fitness",
            coordinates: [-122.42, 37.77],
            priority: "high",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        },
      ],
    };
    const message = await store.appendMessage({
      threadId: created.thread.id,
      role: "assistant",
      parts: [{ type: "mapProposal", actionId: "action-1", proposal, researchSummary: null }],
      now,
    });
    await store.createAction({
      id: "action-1",
      threadId: created.thread.id,
      messageId: message.id,
      partIndex: 0,
      kind: "mapProposal",
      target: {
        kind: "mapProposal",
        messageId: message.id,
        partIndex: 0,
        proposalHash: store.hashPayload(proposal),
        allowedOperationIndexes: [0],
        mapRevision: created.mapSnapshot.revision,
      },
      now,
    });

    const result = await executePlanningAction({
      store,
      now: "2026-06-19T12:01:00.000Z",
      request: {
        threadId: created.thread.id,
        actionId: "action-1",
        idempotencyKey: "idem-1",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: created.mapSnapshot.revision,
        },
      },
    });

    expect(result.action.status).toBe("applied");
    expect(result.mapSnapshot?.mapState.targets.some((target) => target.id === "target-test")).toBe(true);
  });

  test("replays matching idempotency keys before terminal-state rejection", async () => {
    const setup = await createMapProposalAction();

    const first = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:01:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: setup.actionId,
        idempotencyKey: "idem-1",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: setup.mapRevision,
        },
      },
    });
    const second = await executePlanningAction({
      store: setup.store,
      now: "2026-06-19T12:02:00.000Z",
      request: {
        threadId: setup.threadId,
        actionId: setup.actionId,
        idempotencyKey: "idem-1",
        payload: {
          kind: "mapProposal",
          operationIndexes: [0],
          expectedMapRevision: setup.mapRevision,
        },
      },
    });

    expect(second.execution.id).toBe(first.execution.id);
    expect(second.action.status).toBe("applied");
  });
});
```

Add this helper in the same test file:

```ts
async function createMapProposalAction() {
  const store = createMemoryPlanningStore();
  const created = await store.createThread({
    clientInstallationId: "install-1",
    clientInstallationSecretHash: await hashInstallationSecret("secret-1"),
    initialMapState: seedMapState,
    now,
  });
  const proposal: MapPatchProposal = {
    summary: "Add one target",
    confidence: "high",
    requiresUserReview: true,
    operations: [
      {
        type: "addTarget",
        target: {
          id: "target-test",
          name: "Test target",
          purpose: "fitness",
          coordinates: [-122.42, 37.77],
          priority: "high",
          influence: "positive",
          radiusMinutes: 10,
          notes: [],
        },
      },
    ],
  };
  const message = await store.appendMessage({
    threadId: created.thread.id,
    role: "assistant",
    parts: [{ type: "mapProposal", actionId: "action-1", proposal, researchSummary: null }],
    now,
  });
  await store.createAction({
    id: "action-1",
    threadId: created.thread.id,
    messageId: message.id,
    partIndex: 0,
    kind: "mapProposal",
    target: {
      kind: "mapProposal",
      messageId: message.id,
      partIndex: 0,
      proposalHash: store.hashPayload(proposal),
      allowedOperationIndexes: [0],
      mapRevision: created.mapSnapshot.revision,
    },
    now,
  });

  return {
    actionId: "action-1",
    mapRevision: created.mapSnapshot.revision,
    store,
    threadId: created.thread.id,
  };
}
```

- [ ] **Step 3: Write failing route tests**

Create `tests/routes/planning-action-execute-route.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/planning/actions/execute/route";

function createRequest(body: unknown) {
  return new Request("http://localhost/api/planning/actions/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sf-apt-installation-secret": "secret-1",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/planning/actions/execute", () => {
  test("rejects requests without installation secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/planning/actions/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("rejects listing save payloads with client-supplied canonicalUrl", async () => {
    const response = await POST(
      createRequest({
        threadId: "thread-1",
        actionId: "action-1",
        idempotencyKey: "idem-1",
        payload: {
          kind: "listingSave",
          canonicalUrl: "https://example.com/listing/1",
          expectedListingLedgerRevision: "ledger-rev-1",
        },
      }),
    );

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/planning-actions.test.ts tests/routes/planning-action-execute-route.test.ts
```

Expected: FAIL because the action executor and route do not exist.

- [ ] **Step 5: Implement action execution**

`executePlanningAction` handling order:

```ts
export async function executePlanningAction(input: {
  store: PlanningStore;
  request: ExecutePlanningActionRequest;
  now: string;
}): Promise<ExecutePlanningActionResponse> {
  const action = await input.store.getAction(input.request.actionId);
  if (!action || action.threadId !== input.request.threadId) {
    throw new PlanningActionError("action_not_found");
  }

  const payloadHash = input.store.hashPayload(input.request.payload);
  const replay = await input.store.getExecutionByIdempotencyKey(action.id, input.request.idempotencyKey);
  if (replay) {
    if (replay.payloadHash !== payloadHash) {
      throw new PlanningActionError("idempotency_conflict");
    }
    return input.store.buildExecutionResponse(action.id, replay.id);
  }

  if (action.status === "applied" || action.status === "dismissed" || action.failureKind === "permanent") {
    throw new PlanningActionError("action_terminal");
  }

  if (input.request.payload.kind === "mapProposal") {
    return executeMapProposalAction(input, action, payloadHash);
  }

  if (input.request.payload.kind === "listingSave" || input.request.payload.kind === "listingDismiss") {
    return executeListingLifecycleAction(input, action, payloadHash);
  }

  if (input.request.payload.kind === "dismiss") {
    return dismissAction(input, action, payloadHash);
  }

  return executeTargetEditAction(input, action, payloadHash);
}
```

Map proposal execution must load the stored assistant message part, verify `proposalHash`, filter only allowed operation indexes, call `applyProposal(currentSnapshot.mapState, filteredProposal)`, validate the resulting map state, update the `MapSnapshot`, create an execution record, and mark the action `applied`.

- [ ] **Step 6: Implement route wrapper**

`app/api/planning/actions/execute/route.ts` should:

```ts
export async function POST(request: Request) {
  const installationSecret = request.headers.get("x-sf-apt-installation-secret");
  if (!installationSecret) {
    return Response.json({ ok: false, error: "Installation secret required." }, { status: 401 });
  }

  try {
    const body = executePlanningActionRequestSchema.parse(
      await readJsonRequestBody(request, 256 * 1024),
    );
    const result = await executePlanningAction({
      store: getPlanningStore(),
      request: body,
      now: new Date().toISOString(),
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    return toPlanningActionErrorResponse(error);
  }
}
```

Add ownership verification before mutation once Task 3 exposes `verifyThreadOwnership(threadId, installationSecret)`.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/planning-actions.test.ts tests/routes/planning-action-execute-route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/server/planning/actions.ts app/api/planning/actions/execute/route.ts lib/server/planning/store.ts lib/server/planning/memory-store.ts tests/unit/planning-actions.test.ts tests/routes/planning-action-execute-route.test.ts
git commit -m "Add planning action execution"
```

---

### Task 5: Extract Legacy Assistant/Search Helpers

**Files:**
- Modify: `app/api/ai/map-assistant/route.ts`
- Modify: `app/api/ai/listing-search/route.ts`
- Create: `lib/server/map-assistant-service.ts`
- Create: `lib/server/listing-search-service.ts`
- Modify: `tests/routes/map-assistant-route.test.ts`
- Modify: `tests/routes/listing-search-route.test.ts`

**Interfaces:**
- Consumes: existing route request/response contracts.
- Produces: reusable `runMapAssistant(input)` and `runListingSearch(input)` helpers that planning chat can call without making internal HTTP requests.

- [ ] **Step 1: Write route regression tests**

Add assertions to existing route tests:

```ts
test("map assistant route delegates to service and preserves proposal response shape", async () => {
  const response = await POST(createRequest(validMapAssistantRequestBody));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.kind === "proposal" || body.kind === "needsMoreInfo" || body.kind === "noAction").toBe(true);
});

test("listing search route delegates to service and preserves geocode authorization", async () => {
  const response = await POST(createRequest(validListingSearchRequestBody));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toHaveProperty("candidates");
  expect(body).toHaveProperty("geocodeAuthorization");
});
```

Use the existing route test fixtures; do not add network calls.

- [ ] **Step 2: Run tests to verify current GREEN**

Run:

```bash
npm run test -- tests/routes/map-assistant-route.test.ts tests/routes/listing-search-route.test.ts
```

Expected: PASS before extraction. If this fails because of unrelated dirty worktree changes, stop and resolve or isolate before continuing.

- [ ] **Step 3: Extract services without changing behavior**

Move pure route logic into helpers:

```ts
export type RunListingSearchInput = {
  apiKey: string;
  query: string;
  filters?: ListingSearchFilters;
  selectedContext?: ListingSearchSelectedContext;
};

export async function runListingSearch(input: RunListingSearchInput): Promise<ListingSearchResponse> {
  // Existing OpenAI call, structured output parsing, sanitization, and geocode authorization minting.
}
```

```ts
export type RunMapAssistantInput = {
  apiKey: string;
  message: string;
  mapState: MapState;
  selectedZoneIds: string[];
  activeFilters?: ListingSearchFilters;
  geocodeSessionId: string | null;
};

export async function runMapAssistant(input: RunMapAssistantInput): Promise<MapAssistantOutcome> {
  // Existing OpenAI call, researched target/corridor geocoding, proposal validation, and outcome shaping.
}
```

Keep `/api/ai/map-assistant` and `/api/ai/listing-search` as thin wrappers around these helpers.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/routes/map-assistant-route.test.ts tests/routes/listing-search-route.test.ts
```

Expected: PASS with no response-shape changes.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/api/ai/map-assistant/route.ts app/api/ai/listing-search/route.ts lib/server/map-assistant-service.ts lib/server/listing-search-service.ts tests/routes/map-assistant-route.test.ts tests/routes/listing-search-route.test.ts
git commit -m "Extract assistant services for planning chat"
```

---

### Task 6: Unified Planning Chat Route

**Files:**
- Create: `app/api/ai/planning-chat/route.ts`
- Create: `lib/server/planning/chat.ts`
- Create: `lib/server/planning/context.ts`
- Create: `tests/routes/planning-chat-route.test.ts`
- Modify: `lib/server/planning/store.ts`
- Modify: `lib/server/planning/memory-store.ts`

**Interfaces:**
- Consumes: `runMapAssistant`, `runListingSearch`, `PlanningStore`, domain schemas.
- Produces: `POST /api/ai/planning-chat` returning `PlanningChatResponse`.

- [ ] **Step 1: Write failing route tests**

Create `tests/routes/planning-chat-route.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/ai/planning-chat/route";
import { seedMapState } from "@/lib/map/seed-data";

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ai/planning-chat", {
    method: "POST",
    headers: {
      authorization: "Bearer test-key",
      "content-type": "application/json",
      "x-sf-apt-installation-secret": "secret-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/planning-chat", () => {
  test("requires OpenAI key", async () => {
    const response = await POST(createRequest({
      threadId: null,
      clientInstallationId: "install-1",
      clientInstallationSecret: "secret-1",
      message: "Find listings",
      mapState: seedMapState,
      mapRevision: null,
      listingLedgerRevision: null,
      selectedEntity: null,
      visibleContext: null,
    }, { authorization: "" }));

    expect(response.status).toBe(401);
  });

  test("returns a renderable assistant message and map snapshot", async () => {
    const response = await POST(createRequest({
      threadId: null,
      clientInstallationId: "install-1",
      clientInstallationSecret: "secret-1",
      message: "Add pins for Solidcore in SF",
      mapState: seedMapState,
      mapRevision: null,
      listingLedgerRevision: null,
      selectedEntity: null,
      visibleContext: null,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assistantMessage.parts.length).toBeGreaterThan(0);
    expect(body.mapSnapshot.mapState).toEqual(seedMapState);
    expect(Array.isArray(body.actionRecords)).toBe(true);
  });
});
```

Mock `runMapAssistant` and `runListingSearch` in the test so this route test does not call OpenAI.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -- tests/routes/planning-chat-route.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement chat orchestration**

`lib/server/planning/chat.ts` should:

```ts
export async function runPlanningChat(input: {
  apiKey: string;
  request: PlanningChatRequest;
  geocodeSessionId: string | null;
  store: PlanningStore;
  now: string;
}): Promise<PlanningChatResponse> {
  const threadState = await ensureThreadAndSnapshot(input);
  const userMessage = await input.store.appendMessage({
    threadId: threadState.thread.id,
    role: "user",
    parts: [{ type: "text", text: input.request.message }],
    now: input.now,
  });
  const contextSummary = buildPlanningContextSummary(threadState, input.request);
  const assistantParts = await buildAssistantParts(input, threadState, contextSummary);
  const assistantMessage = await input.store.appendMessage({
    threadId: threadState.thread.id,
    role: "assistant",
    parts: assistantParts.parts,
    now: input.now,
  });
  const actionRecords = await input.store.createActionsForMessage({
    threadId: threadState.thread.id,
    message: assistantMessage,
    actionDrafts: assistantParts.actionDrafts,
    now: input.now,
  });

  return {
    thread: threadState.thread,
    userMessage,
    assistantMessage,
    contextSummary,
    actionRecords,
    mapSnapshot: threadState.mapSnapshot,
    listingLedgerRevision: threadState.listingLedgerRevision,
  };
}
```

V1 intent routing can reuse the current `isListingSearchPrompt` logic from `AssistantPanel`, but put it server-side and keep it isolated as `classifyPlanningIntent(message)`. This preserves behavior while leaving room for model-based classification later.

- [ ] **Step 4: Implement route wrapper**

`app/api/ai/planning-chat/route.ts` should:

```ts
export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);
  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = planningChatRequestSchema.parse(
      await readJsonRequestBody(request, 512 * 1024),
    );
    const response = await runPlanningChat({
      apiKey,
      request: body,
      geocodeSessionId: request.headers.get("x-sf-apt-session"),
      store: getPlanningStore(),
      now: new Date().toISOString(),
    });

    return Response.json(response);
  } catch (error) {
    return planningChatErrorResponse(error);
  }
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/routes/planning-chat-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add app/api/ai/planning-chat/route.ts lib/server/planning/chat.ts lib/server/planning/context.ts lib/server/planning/store.ts lib/server/planning/memory-store.ts tests/routes/planning-chat-route.test.ts
git commit -m "Add unified planning chat route"
```

---

### Task 7: Planning Chat Client Storage And UI

**Files:**
- Create: `lib/storage/planning-chat-storage.ts`
- Create: `tests/unit/planning-chat-storage.test.ts`
- Create: `components/apartment-map/planning-chat-panel.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `tests/e2e/apartment-map.spec.ts`

**Interfaces:**
- Consumes: `PlanningChatResponse`, `ExecutePlanningActionResponse`, existing map/listing state callbacks.
- Produces: a persistent local thread cache and chat UI replacing assistant form, proposal dialog, and listing results.

- [ ] **Step 1: Write failing storage tests**

Create or extend a unit test for `lib/storage/planning-chat-storage.ts`:

```ts
test("creates a stable anonymous installation identity", () => {
  const storage = createMemoryStorage();
  const first = loadOrCreatePlanningInstallation(storage);
  const second = loadOrCreatePlanningInstallation(storage);

  expect(second).toEqual(first);
  expect(first.clientInstallationId).toMatch(/^install-/);
  expect(first.clientInstallationSecret.length).toBeGreaterThan(32);
});
```

- [ ] **Step 2: Write failing E2E chat tests**

Add to `tests/e2e/apartment-map.spec.ts`:

```ts
test("planning chat adds reviewed pins through an action card", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatMapProposalResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningActionExecuteMapResponse()),
    });
  });

  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Add pins for all Solidcore locations in SF");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Add 1 map change")).toBeVisible();
  await page.getByRole("button", { name: "Apply all" }).click();
  await expect(page.getByText("Solidcore")).toBeVisible();
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/planning-chat-storage.test.ts
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "planning chat adds reviewed pins"
```

Expected: FAIL because storage and UI do not exist.

- [ ] **Step 4: Implement storage wrapper**

`lib/storage/planning-chat-storage.ts`:

```ts
const planningInstallationStorageKey = "sf-apt-hunt:planning-installation:v1";
const planningThreadCacheStorageKey = "sf-apt-hunt:planning-thread-cache:v1";

export type PlanningInstallation = {
  clientInstallationId: string;
  clientInstallationSecret: string;
};

export function loadOrCreatePlanningInstallation(storage = getBrowserLocalStorage()) {
  const existing = loadPlanningInstallation(storage);
  if (existing) {
    return existing;
  }

  const next = {
    clientInstallationId: `install-${crypto.randomUUID()}`,
    clientInstallationSecret: crypto.randomUUID() + crypto.randomUUID(),
  };
  savePlanningInstallation(next, storage);
  return next;
}
```

Use the same safe storage pattern as `lib/storage/listing-ledger-storage.ts`.

- [ ] **Step 5: Implement PlanningChatPanel**

Required UI:

- one timeline with user and assistant messages
- compact current-context part when present
- one textarea composer labeled `Ask planning chat`
- placeholder examples: `Add pins for all Solidcore locations in SF`, `Find studio or 1BR listings under $3k near my high-priority pins`, `Create a corridor for the 1 California bus`, `Make this selected pin a negative anchor for noise`
- map proposal card with `Apply all` and `Dismiss`
- listing result cards with per-listing `Save` and `Dismiss`
- no manual budget/beds/timing/furnished controls

The submit handler should call `/api/ai/planning-chat` with the OpenAI bearer key, installation header, current map state, selected entity, map revision, listing ledger revision, and visible context.

- [ ] **Step 6: Wire sidebar and app state**

Replace:

```tsx
<AssistantPanel ... />
<ListingResults ... />
<ProposalReviewDialog ... />
```

with:

```tsx
<PlanningChatPanel
  apiKey={apiKey}
  mapState={mapState}
  selectedEntity={selectedEntity}
  selectedZoneIds={selectedZoneIds}
  listings={listings}
  onMapStateChange={onMapStateChange}
  onListingLeadsChange={onListingLeadsChange}
/>
```

Keep `TargetEditor` and `CorridorEditor` above the chat when an entity is selected.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/planning-chat-storage.test.ts
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "planning chat adds reviewed pins"
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/storage/planning-chat-storage.ts components/apartment-map/planning-chat-panel.tsx components/apartment-map/sidebar.tsx components/apartment-map/apartment-map-app.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Replace assistant UI with planning chat"
```

---

### Task 8: Listing Cards, Geocoding, And Reset Integration

**Files:**
- Modify: `components/apartment-map/planning-chat-panel.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `lib/server/planning/chat.ts`
- Create: `app/api/planning/reset/route.ts`
- Modify: `tests/e2e/apartment-map.spec.ts`
- Modify: `tests/routes/planning-chat-route.test.ts`
- Create: `tests/routes/planning-reset-route.test.ts`

**Interfaces:**
- Consumes: listing search response, geocode authorization, existing geocode cache helpers.
- Produces: listing result chat cards with save/dismiss actions, geocoded marker updates, and reset clearing chat/action/listing/map state.

- [ ] **Step 1: Write failing E2E listing-card test**

Add:

```ts
test("planning chat renders listing cards and saves one listing", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningChatListingResponse()),
    });
  });
  await page.route("**/api/planning/actions/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPlanningActionExecuteListingSaveResponse()),
    });
  });

  await page.goto("/");
  await page.getByLabel("Ask planning chat").fill("Find studios under 3000 near my pins");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Test studio")).toBeVisible();
  await page.getByRole("button", { name: "Save listing" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "planning chat renders listing cards"
```

Expected: FAIL until listing cards are wired.

- [ ] **Step 3: Implement listing card actions**

For each `PlanningListingCard`, render:

- title linked to validated `display.url`
- price/beds/neighborhood
- planning score/signals
- source citations
- `Save listing` button calling action endpoint with `saveActionId`
- `Dismiss listing` button calling action endpoint with `dismissActionId`

On action success, update local chat message card state from `messagePatch` when present and update `listingLeads` from returned `listingLead`.

- [ ] **Step 4: Integrate geocoding**

When a planning chat response includes listing cards and `geocodeAuthorization`, reuse the existing geocode candidate flow from `ApartmentMapApp`. Do not duplicate nonce verification logic client-side; keep using `/api/geocode/listing`.

- [ ] **Step 5: Reset behavior**

Create `app/api/planning/reset/route.ts` and `tests/routes/planning-reset-route.test.ts`.

Route test:

```ts
test("reset rejects requests without installation secret", async () => {
  const response = await POST(
    new Request("http://localhost/api/planning/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientInstallationId: "install-1" }),
    }),
  );

  expect(response.status).toBe(401);
});

test("reset clears planning records for the owned installation", async () => {
  const response = await POST(
    new Request("http://localhost/api/planning/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sf-apt-installation-secret": "secret-1",
      },
      body: JSON.stringify({ clientInstallationId: "install-1" }),
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
});
```

`resetLocalMap()` should clear:

- local planning thread cache
- local planning revision cache
- pending chat action state
- server thread/action/listing/map state by calling `/api/planning/reset`

If the reset request fails, keep the local reset complete and show a compact chat warning that server planning history could not be cleared.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "planning chat renders listing cards"
npm run test -- tests/routes/planning-chat-route.test.ts tests/routes/planning-reset-route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add components/apartment-map/planning-chat-panel.tsx components/apartment-map/apartment-map-app.tsx lib/server/planning/chat.ts app/api/planning/reset/route.ts tests/e2e/apartment-map.spec.ts tests/routes/planning-chat-route.test.ts tests/routes/planning-reset-route.test.ts
git commit -m "Add listing actions to planning chat"
```

---

### Task 9: Legacy Cleanup And Full Verification

**Files:**
- Modify: `components/apartment-map/sidebar.tsx`
- Delete: `components/apartment-map/assistant-panel.tsx` after `PlanningChatPanel` owns assistant submission.
- Delete: `components/apartment-map/proposal-review-dialog.tsx` after map proposal cards apply through `/api/planning/actions/execute`.
- Delete: `components/apartment-map/listing-results.tsx` after listing cards render inside `PlanningChatPanel`.
- Modify: `tests/e2e/apartment-map.spec.ts`
- Modify: `docs/superpowers/specs/2026-06-18-planning-chat-architecture-design.md` only if implementation reveals a necessary spec correction.

**Interfaces:**
- Consumes: completed chat UI, planning chat route, action endpoint.
- Produces: clean V1 feature branch ready for review/squash merge.

- [ ] **Step 1: Search for legacy imports**

Run:

```bash
rg -n "AssistantPanel|ProposalReviewDialog|ListingResults|/api/ai/map-assistant|/api/ai/listing-search" app components lib tests
```

Expected: only route tests and preserved compatibility routes should reference old endpoints. No UI should import `AssistantPanel`, `ProposalReviewDialog`, or `ListingResults` unless intentionally reused.

- [ ] **Step 2: Remove unused components**

Delete components only when `rg` proves no imports remain:

```bash
git rm components/apartment-map/assistant-panel.tsx
```

If `ProposalReviewDialog` or `ListingResults` still contain reusable display helpers, move those helpers into `components/apartment-map/planning-chat-panel.tsx` or a new `components/apartment-map/planning-chat-cards.tsx` in this task before deleting the legacy files.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all pass.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: production build passes. If the build needs external font/network access and fails due sandbox network restrictions, rerun with approved network access.

- [ ] **Step 5: Run E2E**

Run:

```bash
npm run test:e2e
```

Expected: all Playwright tests pass against port 3333.

- [ ] **Step 6: Browser smoke test**

Use the in-app Browser at `http://localhost:3333/`:

- send `Add pins for all Solidcore locations in SF`
- verify a chat action card appears
- apply the card
- verify pins appear on the map
- send a listing search prompt
- verify listing cards appear in chat
- save and dismiss individual listings
- refresh and verify the thread remains visible

- [ ] **Step 7: Commit cleanup**

Run:

```bash
git add components/apartment-map/sidebar.tsx components/apartment-map/planning-chat-panel.tsx components/apartment-map/planning-chat-cards.tsx components/apartment-map/assistant-panel.tsx components/apartment-map/proposal-review-dialog.tsx components/apartment-map/listing-results.tsx tests/e2e/apartment-map.spec.ts docs/superpowers/specs/2026-06-18-planning-chat-architecture-design.md
git commit -m "Clean up legacy assistant surfaces"
```

---

## Self-Review

- Spec coverage: The plan covers typed chat parts, action records, server-owned map snapshots, listing lifecycle, action execution, ownership, unified endpoint, local chat UI, action-card review flow, listing cards, reset behavior, and test coverage.
- Intentional v1 compromise: intent routing can temporarily reuse the current deterministic listing-vs-map classifier, but it is isolated in `classifyPlanningIntent(message)` so a later model-based classifier can replace it without changing UI contracts.
- Persistence risk: Redis compare-and-set behavior needs careful implementation. The plan requires revision checks and calls out the fallback if Upstash does not expose a transactional primitive suitable for this use.
- Placeholder scan: no `TBD`/`TODO` placeholders remain, and test steps include executable code rather than prose-only setup.
- Type consistency: action request payloads use `expectedMapRevision` and `expectedListingLedgerRevision`; listing actions derive canonical URLs from stored action targets.
