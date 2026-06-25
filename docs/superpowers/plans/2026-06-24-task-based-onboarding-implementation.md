# Task-Based Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a task-based first-run onboarding checklist that guides signed-out and signed-in users through the real map/chat/listing workflow.

**Architecture:** Add shared onboarding domain types, pure progress helpers, and step metadata, then wire those helpers into local browser storage and workspace-backed persistence. The sidebar renders a compact panel, while existing chat/editor/listing callbacks emit explicit onboarding milestones that complete steps. Driver.js is only a highlight layer behind a small wrapper and never owns progress state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Drizzle/Postgres, Vitest, Playwright, Driver.js.

## Global Constraints

- Support both signed-out `ApartmentMapApp` and signed-in `PersistentApartmentMapApp`.
- Signed-out progress persists through `lib/storage/` only; feature code must not access `window.localStorage` directly.
- Signed-in progress persists in workspace-owned Postgres state.
- OpenAI keys stay browser-local and are never stored server-side.
- Checklist completion must come from real app state/events, not Driver.js tour clicks.
- Driver.js is optional contextual highlighting only.
- Do not add external onboarding SaaS or analytics vendors.
- Workspace reset preserves onboarding progress; workspace delete deletes it through workspace row deletion.
- Signed-in onboarding operations must merge atomically so concurrent `completeSteps` requests cannot lose milestones.
- Onboarding remains recoverable after dismissal or completion without clearing app data.
- Keep diffs focused. Do not refactor unrelated map, planning chat, or persistence code.

---

## File Structure

Create these files:

- `lib/onboarding/steps.ts`: static step definitions, labels, highlight target names, and checklist ordering.
- `lib/onboarding/progress.ts`: pure onboarding progress defaults, operation merge, completion helpers, and state-derived completion.
- `lib/storage/onboarding-storage.ts`: signed-out local storage wrapper.
- `lib/server/workspace-onboarding.ts`: signed-in DB persistence and atomic operation merge.
- `app/api/workspace/onboarding/route.ts`: signed-in onboarding mutation route.
- `components/apartment-map/onboarding-panel.tsx`: presentational checklist panel.
- `components/apartment-map/use-onboarding-highlights.ts`: Driver.js wrapper.
- `components/apartment-map/use-onboarding-controller.ts`: shared client controller for local/workspace persistence.
- `tests/unit/onboarding-progress.test.ts`: pure helper coverage.
- `tests/unit/onboarding-storage.test.ts`: local storage wrapper coverage.
- `tests/unit/workspace-onboarding.test.ts`: DB helper merge/concurrency coverage.
- `tests/routes/workspace-onboarding-route.test.ts`: route contract coverage.

Modify these files:

- `package.json` and `package-lock.json`: add `driver.js`.
- `app/globals.css`: import Driver.js stylesheet.
- `drizzle.config.ts` output files under `drizzle/`: add the generated migration for `workspace.onboarding_progress`.
- `lib/db/schema.ts`: add nullable `onboardingProgress` JSON column to `workspaces`.
- `lib/domain/types.ts`: add onboarding domain/API types and `onboardingProgress` to workspace records.
- `lib/domain/schemas.ts`: add onboarding schemas and include onboarding progress in workspace schemas.
- `lib/server/workspaces.ts`: serialize defaulted onboarding progress in workspace responses.
- `app/api/workspace/client-state/route.ts`: include onboarding progress via existing workspace serializer.
- `components/apartment-map/persistence-types.ts`: validate onboarding progress in signed-in initial state.
- `components/apartment-map/apartment-map-app.tsx`: initialize local controller and complete steps from local workflow events.
- `components/apartment-map/persistent-apartment-map-app.tsx`: initialize workspace controller and persist operations through the new route.
- `components/apartment-map/sidebar.tsx`: render `OnboardingPanel`, forward milestone callbacks, and add data attributes.
- `components/apartment-map/api-key-dialog.tsx`: add stable highlight target and notify through existing key callback.
- `components/apartment-map/planning-chat-panel.tsx`: emit chat milestones and add highlight targets.
- `components/apartment-map/target-editor.tsx`: emit semantic edit events and add highlight target.
- `components/apartment-map/corridor-editor.tsx`: emit semantic edit events and add highlight target.
- `tests/routes/workspace-route.test.ts`: update workspace/client-state expected bodies for onboarding progress.
- `tests/e2e/apartment-map.spec.ts`: add signed-out onboarding workflow coverage.
- `tests/e2e/persistent-workspace.spec.ts`: add signed-in persistence coverage.

---

### Task 1: Onboarding Domain And Pure Progress Helpers

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Create: `lib/onboarding/steps.ts`
- Create: `lib/onboarding/progress.ts`
- Test: `tests/unit/onboarding-progress.test.ts`

**Interfaces:**
- Produces:
  - `OnboardingStepId`
  - `OnboardingProgress`
  - `OnboardingOperation`
  - `PutWorkspaceOnboardingRequest`
  - `PutWorkspaceOnboardingResponse`
  - `onboardingStepIds`
  - `onboardingSteps`
  - `createDefaultOnboardingProgress(now: string): OnboardingProgress`
  - `applyOnboardingOperation(progress: OnboardingProgress, operation: OnboardingOperation, now: string): OnboardingProgress`
  - `completeOnboardingSteps(progress: OnboardingProgress, stepIds: OnboardingStepId[], now: string): OnboardingProgress`
  - `deriveCompletedOnboardingSteps(input: DeriveCompletedOnboardingStepsInput): OnboardingStepId[]`
- Consumes: existing `PlanningThreadCache`, `PlanningChatPart`, `PlanningActionRecord`, `ListingLead`, and `MapState` domain types.

- [ ] **Step 1: Write failing tests for pure progress behavior**

Create `tests/unit/onboarding-progress.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type { OnboardingProgress } from "@/lib/domain/types";
import {
  applyOnboardingOperation,
  completeOnboardingSteps,
  createDefaultOnboardingProgress,
  deriveCompletedOnboardingSteps,
} from "@/lib/onboarding/progress";

const firstNow = "2026-06-24T12:00:00.000Z";
const secondNow = "2026-06-24T12:05:00.000Z";

describe("onboarding progress", () => {
  test("creates default progress", () => {
    expect(createDefaultOnboardingProgress(firstNow)).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: firstNow,
    });
  });

  test("completes steps idempotently and preserves first timestamp", () => {
    const first = completeOnboardingSteps(
      createDefaultOnboardingProgress(firstNow),
      ["set_ai_key"],
      firstNow,
    );
    const second = completeOnboardingSteps(first, ["set_ai_key", "ask_for_listings"], secondNow);

    expect(second.completedSteps.set_ai_key).toBe(firstNow);
    expect(second.completedSteps.ask_for_listings).toBe(secondNow);
    expect(second.updatedAt).toBe(secondNow);
  });

  test("completeSteps operation merges without removing existing completed steps", () => {
    const progress: OnboardingProgress = {
      ...createDefaultOnboardingProgress(firstNow),
      completedSteps: {
        set_ai_key: firstNow,
      },
    };

    const next = applyOnboardingOperation(
      progress,
      { type: "completeSteps", stepIds: ["review_listing"] },
      secondNow,
    );

    expect(next.completedSteps).toEqual({
      set_ai_key: firstNow,
      review_listing: secondNow,
    });
  });

  test("setPanelState does not alter completed steps", () => {
    const progress: OnboardingProgress = {
      ...createDefaultOnboardingProgress(firstNow),
      completedSteps: {
        set_ai_key: firstNow,
      },
    };

    const next = applyOnboardingOperation(
      progress,
      {
        type: "setPanelState",
        dismissed: true,
        expanded: false,
        lastHighlightedStepId: "ask_for_anchors",
      },
      secondNow,
    );

    expect(next.completedSteps).toEqual({ set_ai_key: firstNow });
    expect(next.dismissed).toBe(true);
    expect(next.expanded).toBe(false);
    expect(next.lastHighlightedStepId).toBe("ask_for_anchors");
  });

  test("reset clears completed steps", () => {
    const progress: OnboardingProgress = {
      ...createDefaultOnboardingProgress(firstNow),
      completedSteps: {
        set_ai_key: firstNow,
        review_listing: firstNow,
      },
      dismissed: true,
      expanded: false,
    };

    expect(applyOnboardingOperation(progress, { type: "reset" }, secondNow)).toEqual(
      createDefaultOnboardingProgress(secondNow),
    );
  });

  test("derives completion from strong state signals only", () => {
    expect(
      deriveCompletedOnboardingSteps({
        apiKey: "sk-test",
        planningThreadCache: {
          messages: [
            {
              id: "message-1",
              threadId: "thread-1",
              role: "assistant",
              createdAt: firstNow,
              parts: [
                { type: "text", text: "Listings found." },
                {
                  type: "listingResults",
                  resultSetId: "results-1",
                  sourceSummary: "One listing matched.",
                  caveats: [],
                  geocodeAuthorization: null,
                  listings: [],
                },
              ],
            },
          ],
          actionRecords: [],
        },
        listingLeads: [
          {
            canonicalUrl: "https://example.com/listing",
            firstSeenAt: firstNow,
            lastSeenAt: firstNow,
            lastSearchQuery: "Find listings",
            seenCount: 1,
            status: "saved",
            candidate: {
              id: "candidate-1",
              title: "Listing",
              url: "https://example.com/listing",
              sourceDomain: "example.com",
              neighborhoodGuess: "Mission",
              locationText: null,
              geocodeQuery: null,
              locationConfidence: "none",
              coordinates: null,
              geocodeStatus: "not_attempted",
              markerPrecision: "none",
              priceMonthly: null,
              beds: "unknown",
              shortTermSignal: false,
              furnishedSignal: false,
              fitScore: 3,
              whyItFits: "Potential fit.",
              citations: [],
              caveats: [],
            },
          },
        ],
      }),
    ).toEqual(["set_ai_key", "ask_for_listings", "review_listing"]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test -- tests/unit/onboarding-progress.test.ts
```

Expected: FAIL with missing module errors for `@/lib/onboarding/progress` and missing onboarding types.

- [ ] **Step 3: Add onboarding domain types**

In `lib/domain/types.ts`, add these exports near the workspace/domain response types:

```ts
export type OnboardingStepId =
  | "set_ai_key"
  | "ask_for_anchors"
  | "apply_map_suggestion"
  | "edit_anchor_meaning"
  | "ask_for_listings"
  | "review_listing";

export type OnboardingProgress = {
  version: 1;
  dismissed: boolean;
  expanded: boolean;
  completedSteps: Partial<Record<OnboardingStepId, string>>;
  lastHighlightedStepId: OnboardingStepId | null;
  updatedAt: string;
};

export type OnboardingOperation =
  | { type: "completeSteps"; stepIds: OnboardingStepId[] }
  | {
      type: "setPanelState";
      dismissed?: boolean;
      expanded?: boolean;
      lastHighlightedStepId?: OnboardingStepId | null;
    }
  | { type: "reset" };

export type PutWorkspaceOnboardingRequest = {
  operation: OnboardingOperation;
};

export type PutWorkspaceOnboardingResponse =
  | { ok: true; progress: OnboardingProgress }
  | {
      ok: false;
      error:
        | "forbidden_origin"
        | "unauthorized"
        | "request_too_large"
        | "invalid_request"
        | "onboarding_update_failed";
    };
```

Extend `WorkspaceRecord` in `lib/domain/types.ts`:

```ts
export type WorkspaceRecord = {
  id: string;
  userId: string;
  name: string;
  listingLedgerRevision: string;
  onboardingProgress: OnboardingProgress;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Add onboarding schemas**

In `lib/domain/schemas.ts`, add `OnboardingOperation`, `OnboardingProgress`, and `PutWorkspaceOnboardingRequest/Response` to the type import list. Then add these schemas before `workspaceRecordSchema`:

```ts
export const onboardingStepIdSchema = z.enum([
  "set_ai_key",
  "ask_for_anchors",
  "apply_map_suggestion",
  "edit_anchor_meaning",
  "ask_for_listings",
  "review_listing",
]);

export const onboardingProgressSchema: z.ZodType<OnboardingProgress> = z
  .object({
    version: z.literal(1),
    dismissed: z.boolean(),
    expanded: z.boolean(),
    completedSteps: z.record(onboardingStepIdSchema, z.string().datetime()).partial(),
    lastHighlightedStepId: onboardingStepIdSchema.nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const onboardingOperationSchema: z.ZodType<OnboardingOperation> =
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("completeSteps"),
        stepIds: z.array(onboardingStepIdSchema).min(1).max(6),
      })
      .strict(),
    z
      .object({
        type: z.literal("setPanelState"),
        dismissed: z.boolean().optional(),
        expanded: z.boolean().optional(),
        lastHighlightedStepId: onboardingStepIdSchema.nullable().optional(),
      })
      .strict(),
    z.object({ type: z.literal("reset") }).strict(),
  ]);

export const putWorkspaceOnboardingRequestSchema: z.ZodType<PutWorkspaceOnboardingRequest> = z
  .object({
    operation: onboardingOperationSchema,
  })
  .strict();

export const putWorkspaceOnboardingResponseSchema: z.ZodType<PutWorkspaceOnboardingResponse> =
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), progress: onboardingProgressSchema }).strict(),
    z
      .object({
        ok: z.literal(false),
        error: z.enum([
          "forbidden_origin",
          "unauthorized",
          "request_too_large",
          "invalid_request",
          "onboarding_update_failed",
        ]),
      })
      .strict(),
  ]);
```

Update `workspaceRecordSchema`:

```ts
export const workspaceRecordSchema: z.ZodType<WorkspaceRecord> = z
  .object({
    id: idSchema,
    userId: idSchema,
    name: nameSchema,
    listingLedgerRevision: idSchema,
    onboardingProgress: onboardingProgressSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
```

- [ ] **Step 5: Add step definitions**

Create `lib/onboarding/steps.ts`:

```ts
import type { OnboardingStepId } from "@/lib/domain/types";

export type OnboardingHighlightTarget =
  | "apiKey"
  | "planningChatInput"
  | "proposalCard"
  | "anchorEditor"
  | "mapLayers"
  | "listingCard";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  highlightTarget: OnboardingHighlightTarget;
};

export const onboardingStepIds = [
  "set_ai_key",
  "ask_for_anchors",
  "apply_map_suggestion",
  "edit_anchor_meaning",
  "ask_for_listings",
  "review_listing",
] as const satisfies readonly OnboardingStepId[];

export const onboardingSteps: OnboardingStep[] = [
  {
    id: "set_ai_key",
    title: "Add your OpenAI key",
    description: "Enable chat so the app can help with map anchors and listings.",
    highlightTarget: "apiKey",
  },
  {
    id: "ask_for_anchors",
    title: "Ask chat to add pins or corridors",
    description: "Start with the places and routes that matter to your search.",
    highlightTarget: "planningChatInput",
  },
  {
    id: "apply_map_suggestion",
    title: "Review a suggested map change",
    description: "Apply only the pins or corridors you want to keep.",
    highlightTarget: "proposalCard",
  },
  {
    id: "edit_anchor_meaning",
    title: "Give an anchor planning meaning",
    description: "Set priority, purpose, influence, tags, or notes.",
    highlightTarget: "anchorEditor",
  },
  {
    id: "ask_for_listings",
    title: "Ask for listings near your priorities",
    description: "Use your map context to search for matching leads.",
    highlightTarget: "planningChatInput",
  },
  {
    id: "review_listing",
    title: "Save or dismiss a listing",
    description: "Keep promising leads and remove poor fits.",
    highlightTarget: "listingCard",
  },
];
```

- [ ] **Step 6: Add pure progress helpers**

Create `lib/onboarding/progress.ts`:

```ts
import type {
  ListingLead,
  OnboardingOperation,
  OnboardingProgress,
  OnboardingStepId,
  PlanningChatPart,
} from "@/lib/domain/types";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";

export type DeriveCompletedOnboardingStepsInput = {
  apiKey: string | null;
  planningThreadCache?: Pick<PlanningThreadCache, "messages" | "actionRecords"> | null;
  listingLeads: ListingLead[];
};

export function createDefaultOnboardingProgress(now: string): OnboardingProgress {
  return {
    version: 1,
    dismissed: false,
    expanded: true,
    completedSteps: {},
    lastHighlightedStepId: null,
    updatedAt: now,
  };
}

export function completeOnboardingSteps(
  progress: OnboardingProgress,
  stepIds: OnboardingStepId[],
  now: string,
): OnboardingProgress {
  const nextCompletedSteps = { ...progress.completedSteps };
  let changed = false;

  for (const stepId of stepIds) {
    if (nextCompletedSteps[stepId]) {
      continue;
    }

    nextCompletedSteps[stepId] = now;
    changed = true;
  }

  if (!changed) {
    return progress;
  }

  return {
    ...progress,
    completedSteps: nextCompletedSteps,
    updatedAt: now,
  };
}

export function applyOnboardingOperation(
  progress: OnboardingProgress,
  operation: OnboardingOperation,
  now: string,
): OnboardingProgress {
  if (operation.type === "completeSteps") {
    return completeOnboardingSteps(progress, operation.stepIds, now);
  }

  if (operation.type === "reset") {
    return createDefaultOnboardingProgress(now);
  }

  return {
    ...progress,
    dismissed: operation.dismissed ?? progress.dismissed,
    expanded: operation.expanded ?? progress.expanded,
    lastHighlightedStepId:
      "lastHighlightedStepId" in operation
        ? operation.lastHighlightedStepId ?? null
        : progress.lastHighlightedStepId,
    updatedAt: now,
  };
}

export function deriveCompletedOnboardingSteps({
  apiKey,
  listingLeads,
  planningThreadCache,
}: DeriveCompletedOnboardingStepsInput): OnboardingStepId[] {
  const completed = new Set<OnboardingStepId>();

  if (apiKey) {
    completed.add("set_ai_key");
  }

  if (planningThreadCache?.messages.some((message) => message.parts.some(isListingResultsPart))) {
    completed.add("ask_for_listings");
  }

  if (
    planningThreadCache?.messages.some((message) =>
      message.parts.some((part) => part.type === "mapProposal" || part.type === "targetEditProposal"),
    )
  ) {
    completed.add("ask_for_anchors");
  }

  if (
    planningThreadCache?.actionRecords.some(
      (action) =>
        action.status === "applied" &&
        (action.kind === "mapProposal" || action.kind === "targetEditProposal"),
    )
  ) {
    completed.add("apply_map_suggestion");
  }

  if (listingLeads.some((lead) => lead.status === "saved" || lead.status === "dismissed")) {
    completed.add("review_listing");
  }

  return Array.from(completed);
}

function isListingResultsPart(part: PlanningChatPart) {
  return part.type === "listingResults";
}
```

- [ ] **Step 7: Run unit tests**

Run:

```bash
npm run test -- tests/unit/onboarding-progress.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add lib/domain/types.ts lib/domain/schemas.ts lib/onboarding/steps.ts lib/onboarding/progress.ts tests/unit/onboarding-progress.test.ts
git commit -m "Add onboarding progress domain"
```

---

### Task 2: Signed-Out Onboarding Storage

**Files:**
- Create: `lib/storage/onboarding-storage.ts`
- Test: `tests/unit/onboarding-storage.test.ts`

**Interfaces:**
- Consumes: `OnboardingProgress`, `onboardingProgressSchema`, `createDefaultOnboardingProgress`.
- Produces:
  - `onboardingProgressStorageKey`
  - `loadOnboardingProgress(storage?, now?)`
  - `saveOnboardingProgress(progress, storage?)`
  - `clearOnboardingProgress(storage?)`

- [ ] **Step 1: Write failing storage tests**

Create `tests/unit/onboarding-storage.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  clearOnboardingProgress,
  loadOnboardingProgress,
  onboardingProgressStorageKey,
  saveOnboardingProgress,
} from "@/lib/storage/onboarding-storage";

const now = "2026-06-24T12:00:00.000Z";

class FakeStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

describe("onboarding storage", () => {
  test("loads default progress when storage is empty", () => {
    expect(loadOnboardingProgress(new FakeStorage(), now)).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: now,
    });
  });

  test("saves and reloads valid progress", () => {
    const storage = new FakeStorage();
    const progress = {
      version: 1 as const,
      dismissed: false,
      expanded: true,
      completedSteps: { set_ai_key: now },
      lastHighlightedStepId: "set_ai_key" as const,
      updatedAt: now,
    };

    expect(saveOnboardingProgress(progress, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(onboardingProgressStorageKey) ?? "{}")).toEqual(progress);
    expect(loadOnboardingProgress(storage, "2026-06-24T13:00:00.000Z")).toEqual(progress);
  });

  test("invalid JSON falls back to default progress", () => {
    const storage = new FakeStorage();
    storage.setItem(onboardingProgressStorageKey, "{");

    expect(loadOnboardingProgress(storage, now)).toEqual({
      version: 1,
      dismissed: false,
      expanded: true,
      completedSteps: {},
      lastHighlightedStepId: null,
      updatedAt: now,
    });
  });

  test("schema mismatch falls back to default progress", () => {
    const storage = new FakeStorage();
    storage.setItem(onboardingProgressStorageKey, JSON.stringify({ version: 2 }));

    expect(loadOnboardingProgress(storage, now).version).toBe(1);
    expect(loadOnboardingProgress(storage, now).completedSteps).toEqual({});
  });

  test("clear removes stored progress", () => {
    const storage = new FakeStorage();
    saveOnboardingProgress(loadOnboardingProgress(storage, now), storage);

    clearOnboardingProgress(storage);

    expect(storage.getItem(onboardingProgressStorageKey)).toBeNull();
  });

  test("storage failures return safe defaults", () => {
    const storage = new ThrowingStorage();

    expect(loadOnboardingProgress(storage, now).version).toBe(1);
    expect(saveOnboardingProgress(loadOnboardingProgress(undefined, now), storage)).toBe(false);
    expect(() => clearOnboardingProgress(storage)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- tests/unit/onboarding-storage.test.ts
```

Expected: FAIL with missing module `@/lib/storage/onboarding-storage`.

- [ ] **Step 3: Implement storage wrapper**

Create `lib/storage/onboarding-storage.ts`:

```ts
import { onboardingProgressSchema } from "@/lib/domain/schemas";
import type { OnboardingProgress } from "@/lib/domain/types";
import { createDefaultOnboardingProgress } from "@/lib/onboarding/progress";

export const onboardingProgressStorageKey = "sf-apt-hunt:onboarding-progress:v1";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function getBrowserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveLocalStorage(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? getBrowserLocalStorage();
  } catch {
    return null;
  }
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadOnboardingProgress(
  storage?: StorageLike,
  now = new Date().toISOString(),
): OnboardingProgress {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return createDefaultOnboardingProgress(now);
  }

  try {
    const raw = localStorage.getItem(onboardingProgressStorageKey);
    if (!raw) {
      return createDefaultOnboardingProgress(now);
    }

    const parsed = onboardingProgressSchema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : createDefaultOnboardingProgress(now);
  } catch (error) {
    console.warn("[onboarding-storage] failed to load onboarding progress", error);
    return createDefaultOnboardingProgress(now);
  }
}

export function saveOnboardingProgress(
  progress: OnboardingProgress,
  storage?: StorageLike,
) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return false;
  }

  try {
    localStorage.setItem(onboardingProgressStorageKey, JSON.stringify(progress));
    return true;
  } catch (error) {
    console.warn("[onboarding-storage] failed to save onboarding progress", error);
    return false;
  }
}

export function clearOnboardingProgress(storage?: StorageLike) {
  const localStorage = resolveLocalStorage(storage);
  if (!localStorage) {
    return;
  }

  try {
    localStorage.removeItem(onboardingProgressStorageKey);
  } catch (error) {
    console.warn("[onboarding-storage] failed to clear onboarding progress", error);
  }
}
```

- [ ] **Step 4: Run storage tests**

Run:

```bash
npm run test -- tests/unit/onboarding-storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/storage/onboarding-storage.ts tests/unit/onboarding-storage.test.ts
git commit -m "Add onboarding local storage"
```

---

### Task 3: Workspace Onboarding Persistence And Route

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `drizzle/0001_*.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `drizzle/meta/0001_snapshot.json`
- Modify: `lib/server/workspaces.ts`
- Create: `lib/server/workspace-onboarding.ts`
- Create: `app/api/workspace/onboarding/route.ts`
- Modify: `app/api/workspace/client-state/route.ts`
- Modify: `components/apartment-map/persistence-types.ts`
- Modify: `tests/routes/workspace-route.test.ts`
- Create: `tests/routes/workspace-onboarding-route.test.ts`
- Create: `tests/unit/workspace-onboarding.test.ts`

**Interfaces:**
- Consumes: `OnboardingOperation`, `OnboardingProgress`, schemas from Task 1.
- Produces:
  - `updateWorkspaceOnboarding(input: { workspaceId: string; operation: OnboardingOperation; now?: string }): Promise<OnboardingProgress>`
  - `GET /api/workspace` and `GET /api/workspace/client-state` include `workspace.onboardingProgress`
  - `PUT /api/workspace/onboarding`

- [ ] **Step 1: Write failing route tests**

Create `tests/routes/workspace-onboarding-route.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { OnboardingOperation, OnboardingProgress } from "@/lib/domain/types";

const sessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));
const workspaceMocks = vi.hoisted(() => ({
  updateWorkspaceOnboarding: vi.fn(),
}));

vi.mock("@/lib/server/auth/session", () => {
  class MockUnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
    }
  }

  return {
    UnauthorizedError: MockUnauthorizedError,
    requireCurrentUserId: async () => {
      if (!sessionMock.userId) {
        throw new MockUnauthorizedError();
      }

      return sessionMock.userId;
    },
  };
});

vi.mock("@/lib/server/workspaces", () => ({
  getOrCreateDefaultWorkspace: async (userId: string) => ({
    workspace: {
      id: "workspace-1",
      userId,
      name: "Apartment hunt",
      listingLedgerRevision: "ledger-1",
      onboardingProgress: createProgress(),
      createdAt: new Date("2026-06-24T12:00:00.000Z"),
      updatedAt: new Date("2026-06-24T12:00:00.000Z"),
    },
  }),
}));

vi.mock("@/lib/server/workspace-onboarding", () => ({
  updateWorkspaceOnboarding: workspaceMocks.updateWorkspaceOnboarding,
}));

import { PUT } from "@/app/api/workspace/onboarding/route";

describe("PUT /api/workspace/onboarding", () => {
  beforeEach(() => {
    sessionMock.userId = null;
    workspaceMocks.updateWorkspaceOnboarding.mockReset();
    workspaceMocks.updateWorkspaceOnboarding.mockResolvedValue({
      ok: true,
      progress: createProgress({
        completedSteps: {
          set_ai_key: "2026-06-24T12:05:00.000Z",
        },
      }),
    });
  });

  test("rejects signed-out users", async () => {
    const response = await PUT(createRequest({ type: "completeSteps", stepIds: ["set_ai_key"] }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(workspaceMocks.updateWorkspaceOnboarding).not.toHaveBeenCalled();
  });

  test("rejects cross-site writes", async () => {
    sessionMock.userId = "user-1";

    const response = await PUT(
      createRequest(
        { type: "completeSteps", stepIds: ["set_ai_key"] },
        {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "forbidden_origin" });
    expect(workspaceMocks.updateWorkspaceOnboarding).not.toHaveBeenCalled();
  });

  test("rejects invalid bodies", async () => {
    sessionMock.userId = "user-1";

    const response = await PUT(createRawRequest({ operation: { type: "completeSteps", stepIds: [] } }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
  });

  test("returns 413 for oversized bodies", async () => {
    sessionMock.userId = "user-1";

    const response = await PUT(
      new Request("http://localhost/api/workspace/onboarding", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ operation: { type: "reset" }, padding: "x".repeat(20_000) }),
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "request_too_large" });
  });

  test("updates the current user's default workspace", async () => {
    sessionMock.userId = "user-1";
    const operation: OnboardingOperation = { type: "completeSteps", stepIds: ["set_ai_key"] };

    const response = await PUT(createRequest(operation));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      progress: createProgress({
        completedSteps: {
          set_ai_key: "2026-06-24T12:05:00.000Z",
        },
      }),
    });
    expect(workspaceMocks.updateWorkspaceOnboarding).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      operation,
    });
  });

  test("returns safe 500 when persistence fails", async () => {
    sessionMock.userId = "user-1";
    workspaceMocks.updateWorkspaceOnboarding.mockRejectedValueOnce(new Error("db down"));

    const response = await PUT(createRequest({ type: "reset" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "onboarding_update_failed" });
  });
});

function createRequest(operation: OnboardingOperation, headers: Record<string, string> = {}) {
  return createRawRequest({ operation }, headers);
}

function createRawRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/workspace/onboarding", {
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

function createProgress(overrides: Partial<OnboardingProgress> = {}): OnboardingProgress {
  return {
    version: 1,
    dismissed: false,
    expanded: true,
    completedSteps: {},
    lastHighlightedStepId: null,
    updatedAt: "2026-06-24T12:00:00.000Z",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run route test and verify it fails**

Run:

```bash
npm run test -- tests/routes/workspace-onboarding-route.test.ts
```

Expected: FAIL with missing route module.

- [ ] **Step 3: Write failing workspace DB helper tests**

Create `tests/unit/workspace-onboarding.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

import { workspaces } from "@/lib/db/schema";
import type { OnboardingProgress } from "@/lib/domain/types";

const dbMock = vi.hoisted(() => ({
  current: null as ReturnType<typeof createDbMock> | null,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
}));

vi.mock("@/lib/db/client", () => ({
  requireDb: () => {
    if (!dbMock.current) {
      throw new Error("Database mock not initialized");
    }

    return dbMock.current;
  },
}));

import { updateWorkspaceOnboarding } from "@/lib/server/workspace-onboarding";

describe("workspace onboarding persistence", () => {
  beforeEach(() => {
    dbMock.current = createDbMock();
  });

  test("completeSteps merges with existing DB progress", async () => {
    getDb().state.workspace.onboardingProgress = createProgress({
      completedSteps: {
        set_ai_key: "2026-06-24T12:00:00.000Z",
      },
    });

    const result = await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "completeSteps", stepIds: ["ask_for_listings"] },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(result.completedSteps).toEqual({
      set_ai_key: "2026-06-24T12:00:00.000Z",
      ask_for_listings: "2026-06-24T12:05:00.000Z",
    });
    expect(getDb().state.workspace.onboardingProgress).toEqual(result);
  });

  test("concurrent completeSteps requests both persist", async () => {
    getDb().hooks.beforeUpdateOnce = () => {
      getDb().state.workspace.onboardingProgress = createProgress({
        completedSteps: {
          set_ai_key: "2026-06-24T12:01:00.000Z",
        },
      });
    };

    await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "completeSteps", stepIds: ["ask_for_listings"] },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(getDb().state.workspace.onboardingProgress?.completedSteps).toEqual({
      set_ai_key: "2026-06-24T12:01:00.000Z",
      ask_for_listings: "2026-06-24T12:05:00.000Z",
    });
  });

  test("setPanelState does not alter completed steps", async () => {
    getDb().state.workspace.onboardingProgress = createProgress({
      completedSteps: {
        set_ai_key: "2026-06-24T12:00:00.000Z",
      },
    });

    const result = await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "setPanelState", dismissed: true, expanded: false },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(result.completedSteps).toEqual({ set_ai_key: "2026-06-24T12:00:00.000Z" });
    expect(result.dismissed).toBe(true);
    expect(result.expanded).toBe(false);
  });

  test("reset clears completed steps", async () => {
    getDb().state.workspace.onboardingProgress = createProgress({
      completedSteps: {
        set_ai_key: "2026-06-24T12:00:00.000Z",
      },
    });

    const result = await updateWorkspaceOnboarding({
      workspaceId: "workspace-1",
      operation: { type: "reset" },
      now: "2026-06-24T12:05:00.000Z",
    });

    expect(result).toEqual(createProgress({ updatedAt: "2026-06-24T12:05:00.000Z" }));
  });
});

function getDb() {
  if (!dbMock.current) {
    throw new Error("Database mock not initialized");
  }

  return dbMock.current;
}

function createProgress(overrides: Partial<OnboardingProgress> = {}): OnboardingProgress {
  return {
    version: 1,
    dismissed: false,
    expanded: true,
    completedSteps: {},
    lastHighlightedStepId: null,
    updatedAt: "2026-06-24T12:00:00.000Z",
    ...overrides,
  };
}

function createDbMock() {
  const state = {
    workspace: {
      id: "workspace-1",
      onboardingProgress: null as OnboardingProgress | null,
      updatedAt: new Date("2026-06-24T12:00:00.000Z"),
    },
  };
  const hooks = {
    beforeUpdateOnce: null as null | (() => void),
  };

  return {
    state,
    hooks,
    transaction: async <T>(callback: (tx: ReturnType<typeof createTx>) => Promise<T>) =>
      callback(createTx(state, hooks)),
  };
}

function createTx(
  state: ReturnType<typeof createDbMock>["state"],
  hooks: ReturnType<typeof createDbMock>["hooks"],
) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => ({
          for: async (lock: "update") => {
            expect(table).toBe(workspaces);
            expect(lock).toBe("update");
            expect(condition).toMatchObject({ type: "eq" });
            return [state.workspace];
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Partial<typeof state.workspace>) => ({
        where: () => ({
          returning: async () => {
            expect(table).toBe(workspaces);
            hooks.beforeUpdateOnce?.();
            hooks.beforeUpdateOnce = null;
            const currentCompleted = state.workspace.onboardingProgress?.completedSteps ?? {};
            const nextCompleted = values.onboardingProgress?.completedSteps ?? {};
            state.workspace = {
              ...state.workspace,
              ...values,
              onboardingProgress: values.onboardingProgress
                ? {
                    ...values.onboardingProgress,
                    completedSteps: {
                      ...currentCompleted,
                      ...nextCompleted,
                    },
                  }
                : values.onboardingProgress ?? null,
            };
            return [state.workspace];
          },
        }),
      }),
    }),
  };
}
```

- [ ] **Step 4: Run DB helper test and verify it fails**

Run:

```bash
npm run test -- tests/unit/workspace-onboarding.test.ts
```

Expected: FAIL with missing module `@/lib/server/workspace-onboarding`.

- [ ] **Step 5: Add DB column and migration**

Modify `lib/db/schema.ts` in the `workspaces` table:

```ts
onboardingProgress: jsonb("onboarding_progress").$type<OnboardingProgress | null>(),
```

Add `OnboardingProgress` to the type import from `@/lib/domain/types`.

Run:

```bash
npm run db:generate
```

Expected: Drizzle creates a new migration under `drizzle/` with SQL equivalent to:

```sql
ALTER TABLE "workspace" ADD COLUMN "onboarding_progress" jsonb;
```

- [ ] **Step 6: Update workspace serializers**

In `lib/server/workspaces.ts`, import:

```ts
import { onboardingProgressSchema } from "@/lib/domain/schemas";
import { createDefaultOnboardingProgress } from "@/lib/onboarding/progress";
```

Add:

```ts
function normalizeOnboardingProgress(value: unknown, now = new Date().toISOString()) {
  const parsed = onboardingProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : createDefaultOnboardingProgress(now);
}
```

Update `serializeWorkspaceRecord` to include:

```ts
onboardingProgress: normalizeOnboardingProgress(workspace.onboardingProgress),
```

Update any workspace test mocks that serialize workspace records to include `onboardingProgress`.

- [ ] **Step 7: Implement workspace onboarding helper**

Create `lib/server/workspace-onboarding.ts`:

```ts
import "server-only";

import { eq } from "drizzle-orm";

import { workspaces } from "@/lib/db/schema";
import type { OnboardingOperation } from "@/lib/domain/types";
import { requireDb } from "@/lib/db/client";
import { onboardingProgressSchema } from "@/lib/domain/schemas";
import {
  applyOnboardingOperation,
  createDefaultOnboardingProgress,
} from "@/lib/onboarding/progress";

export async function updateWorkspaceOnboarding({
  now = new Date().toISOString(),
  operation,
  workspaceId,
}: {
  workspaceId: string;
  operation: OnboardingOperation;
  now?: string;
}) {
  return requireDb().transaction(async (tx) => {
    const [workspace] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const currentParse = onboardingProgressSchema.safeParse(workspace.onboardingProgress);
    const current = currentParse.success ? currentParse.data : createDefaultOnboardingProgress(now);
    const nextProgress = applyOnboardingOperation(current, operation, now);

    const [updated] = await tx
      .update(workspaces)
      .set({
        onboardingProgress: nextProgress,
        updatedAt: new Date(now),
      })
      .where(eq(workspaces.id, workspaceId))
      .returning();

    const parsed = onboardingProgressSchema.parse(updated.onboardingProgress);
    return parsed;
  });
}
```

- [ ] **Step 8: Implement workspace onboarding route**

Create `app/api/workspace/onboarding/route.ts`:

```ts
import { z } from "zod";

import { putWorkspaceOnboardingRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUserId } from "@/lib/server/auth/session";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";
import { updateWorkspaceOnboarding } from "@/lib/server/workspace-onboarding";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

const MAX_WORKSPACE_ONBOARDING_REQUEST_BYTES = 16 * 1024;

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const userId = await requireCurrentUserId(request);
    const body = putWorkspaceOnboardingRequestSchema.parse(
      await readJsonRequestBody(request, MAX_WORKSPACE_ONBOARDING_REQUEST_BYTES),
    );
    const { workspace } = await getOrCreateDefaultWorkspace(userId);
    const progress = await updateWorkspaceOnboarding({
      workspaceId: workspace.id,
      operation: body.operation,
    });

    return Response.json({ ok: true, progress });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "forbidden_origin" }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "request_too_large" }, { status: 413 });
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }

    console.error("[workspace-onboarding-route]", error);
    return Response.json({ ok: false, error: "onboarding_update_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 9: Update workspace initial state schemas and tests**

Update `components/apartment-map/persistence-types.ts` only if `workspaceRecordSchema` already carries `onboardingProgress`. No separate field is needed when `workspace.onboardingProgress` is part of `WorkspaceRecord`.

Update `tests/routes/workspace-route.test.ts` expected workspace bodies to include:

```ts
onboardingProgress: {
  version: 1,
  dismissed: false,
  expanded: true,
  completedSteps: {},
  lastHighlightedStepId: null,
  updatedAt: expect.any(String),
},
```

When exact timestamps are awkward in route mocks, set mock workspace `onboardingProgress` to:

```ts
{
  version: 1,
  dismissed: false,
  expanded: true,
  completedSteps: {},
  lastHighlightedStepId: null,
  updatedAt: "2026-06-24T12:00:00.000Z",
}
```

- [ ] **Step 10: Run workspace tests**

Run:

```bash
npm run test -- tests/unit/workspace-onboarding.test.ts tests/routes/workspace-onboarding-route.test.ts tests/routes/workspace-route.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 3**

```bash
git add lib/db/schema.ts drizzle lib/server/workspaces.ts lib/server/workspace-onboarding.ts app/api/workspace/onboarding/route.ts components/apartment-map/persistence-types.ts tests/unit/workspace-onboarding.test.ts tests/routes/workspace-onboarding-route.test.ts tests/routes/workspace-route.test.ts
git commit -m "Persist workspace onboarding progress"
```

---

### Task 4: Onboarding Panel And Client Controller

**Files:**
- Create: `components/apartment-map/onboarding-panel.tsx`
- Create: `components/apartment-map/use-onboarding-controller.ts`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `components/apartment-map/persistent-apartment-map-app.tsx`

**Interfaces:**
- Consumes: `OnboardingProgress`, `OnboardingOperation`, `onboardingSteps`, storage wrapper, workspace route.
- Produces:
  - `OnboardingPanel`
  - `useOnboardingController`
  - `Sidebar` onboarding props.

- [ ] **Step 1: Add controller hook**

Create `components/apartment-map/use-onboarding-controller.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { putWorkspaceOnboardingResponseSchema } from "@/lib/domain/schemas";
import type {
  ListingLead,
  OnboardingOperation,
  OnboardingProgress,
  OnboardingStepId,
} from "@/lib/domain/types";
import {
  applyOnboardingOperation,
  completeOnboardingSteps,
  createDefaultOnboardingProgress,
  deriveCompletedOnboardingSteps,
} from "@/lib/onboarding/progress";
import {
  loadOnboardingProgress,
  saveOnboardingProgress,
} from "@/lib/storage/onboarding-storage";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";

type OnboardingPersistenceMode =
  | { kind: "local" }
  | { kind: "workspace"; initialProgress: OnboardingProgress };

export type OnboardingController = {
  progress: OnboardingProgress;
  persistenceError: string | null;
  completedCount: number;
  completeSteps: (stepIds: OnboardingStepId[]) => void;
  setPanelState: (state: {
    dismissed?: boolean;
    expanded?: boolean;
    lastHighlightedStepId?: OnboardingStepId | null;
  }) => void;
  reset: () => void;
};

export function useOnboardingController({
  apiKey,
  listingLeads,
  mode,
  planningThreadCache,
}: {
  apiKey: string | null;
  listingLeads: ListingLead[];
  mode: OnboardingPersistenceMode;
  planningThreadCache: PlanningThreadCache | null;
}): OnboardingController {
  const [progress, setProgress] = useState<OnboardingProgress>(() =>
    mode.kind === "workspace"
      ? mode.initialProgress
      : loadOnboardingProgress(undefined, new Date().toISOString()),
  );
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  const persistOperation = useCallback(
    async (operation: OnboardingOperation, optimisticProgress: OnboardingProgress) => {
      if (mode.kind === "local") {
        saveOnboardingProgress(optimisticProgress);
        return;
      }

      try {
        const response = await fetch("/api/workspace/onboarding", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation }),
        });
        const body: unknown = await response.json().catch(() => null);
        const parsed = putWorkspaceOnboardingResponseSchema.parse(body);

        if (!parsed.ok) {
          setPersistenceError("Getting started progress could not be saved.");
          return;
        }

        setProgress(parsed.progress);
        setPersistenceError(null);
      } catch {
        setPersistenceError("Getting started progress could not be saved.");
      }
    },
    [mode],
  );

  const applyOperation = useCallback(
    (operation: OnboardingOperation) => {
      const now = new Date().toISOString();
      setProgress((current) => {
        const next = applyOnboardingOperation(current, operation, now);
        void persistOperation(operation, next);
        return next;
      });
    },
    [persistOperation],
  );

  const completeSteps = useCallback(
    (stepIds: OnboardingStepId[]) => {
      if (stepIds.length === 0) {
        return;
      }
      applyOperation({ type: "completeSteps", stepIds });
    },
    [applyOperation],
  );

  useEffect(() => {
    const derived = deriveCompletedOnboardingSteps({
      apiKey,
      listingLeads,
      planningThreadCache,
    }).filter((stepId) => !progress.completedSteps[stepId]);

    if (derived.length > 0) {
      completeSteps(derived);
    }
  }, [apiKey, completeSteps, listingLeads, planningThreadCache, progress.completedSteps]);

  return useMemo(
    () => ({
      progress,
      persistenceError,
      completedCount: Object.keys(progress.completedSteps).length,
      completeSteps,
      setPanelState: (state) => applyOperation({ type: "setPanelState", ...state }),
      reset: () => applyOperation({ type: "reset" }),
    }),
    [applyOperation, completeSteps, persistenceError, progress],
  );
}
```

- [ ] **Step 2: Add panel component**

Create `components/apartment-map/onboarding-panel.tsx`:

```tsx
"use client";

import type { OnboardingStepId } from "@/lib/domain/types";
import { onboardingSteps } from "@/lib/onboarding/steps";
import { Button } from "@/components/ui/button";

export function OnboardingPanel({
  completedCount,
  onDismiss,
  onReset,
  onReview,
  onShowStep,
  persistenceError,
  progress,
}: {
  completedCount: number;
  progress: {
    dismissed: boolean;
    expanded: boolean;
    completedSteps: Partial<Record<OnboardingStepId, string>>;
  };
  persistenceError: string | null;
  onDismiss: () => void;
  onReset: () => void;
  onReview: () => void;
  onShowStep: (stepId: OnboardingStepId) => void;
}) {
  const totalCount = onboardingSteps.length;
  const isComplete = completedCount === totalCount;

  if (progress.dismissed) {
    return (
      <section className="border-b border-sidebar-border p-3 text-xs">
        <Button size="sm" variant="outline" onClick={onReview}>
          Show getting started
        </Button>
      </section>
    );
  }

  if (isComplete && !progress.expanded) {
    return (
      <section className="border-b border-sidebar-border p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Getting started complete</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onReview}>
              Review steps
            </Button>
            <Button size="sm" variant="outline" onClick={onReset}>
              Reset onboarding
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-sidebar-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Getting started</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {completedCount} of {totalCount} complete
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button size="sm" variant="outline" onClick={onReset}>
            Reset onboarding
          </Button>
        </div>
      </div>

      <ol className="mt-3 space-y-2">
        {onboardingSteps.map((step) => {
          const completedAt = progress.completedSteps[step.id];
          return (
            <li key={step.id} className="border border-border p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium">
                    {completedAt ? "Complete" : "Next"}: {step.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onShowStep(step.id)}>
                  Show me
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      {persistenceError ? (
        <p className="mt-3 text-xs text-destructive">{persistenceError}</p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Wire panel through Sidebar**

Modify `components/apartment-map/sidebar.tsx` imports:

```ts
import type { OnboardingStepId } from "@/lib/domain/types";
import { OnboardingPanel } from "@/components/apartment-map/onboarding-panel";
import type { OnboardingController } from "@/components/apartment-map/use-onboarding-controller";
```

Add props:

```ts
onboarding: OnboardingController;
onShowOnboardingStep: (stepId: OnboardingStepId) => void;
```

Render after the title/status block:

```tsx
<OnboardingPanel
  completedCount={onboarding.completedCount}
  persistenceError={onboarding.persistenceError}
  progress={onboarding.progress}
  onDismiss={() => onboarding.setPanelState({ dismissed: true, expanded: false })}
  onReset={onboarding.reset}
  onReview={() => onboarding.setPanelState({ dismissed: false, expanded: true })}
  onShowStep={onShowOnboardingStep}
/>
```

- [ ] **Step 4: Wire local app controller**

In `components/apartment-map/apartment-map-app.tsx`, import `useOnboardingController` and initialize:

```ts
const onboarding = useOnboardingController({
  apiKey,
  listingLeads,
  mode: { kind: "local" },
  planningThreadCache: null,
});
```

Pass `onboarding` to `Sidebar`. For `onShowOnboardingStep`, pass a temporary no-op until Task 5:

```ts
onShowOnboardingStep={() => undefined}
```

- [ ] **Step 5: Wire workspace app controller**

In `components/apartment-map/persistent-apartment-map-app.tsx`, initialize:

```ts
const onboarding = useOnboardingController({
  apiKey,
  listingLeads,
  mode: {
    kind: "workspace",
    initialProgress:
      workspaceState?.workspace.onboardingProgress ??
      initialState?.workspace.onboardingProgress ??
      createDefaultOnboardingProgress(new Date().toISOString()),
  },
  planningThreadCache: workspaceState?.planningThreadCache ?? initialState?.planningThreadCache ?? null,
});
```

Import `createDefaultOnboardingProgress`. Pass `onboarding` and temporary `onShowOnboardingStep={() => undefined}` to `Sidebar`.

- [ ] **Step 6: Run focused typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add components/apartment-map/onboarding-panel.tsx components/apartment-map/use-onboarding-controller.ts components/apartment-map/sidebar.tsx components/apartment-map/apartment-map-app.tsx components/apartment-map/persistent-apartment-map-app.tsx
git commit -m "Add onboarding checklist panel"
```

---

### Task 5: Driver.js Highlights

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/globals.css`
- Create: `components/apartment-map/use-onboarding-highlights.ts`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/api-key-dialog.tsx`
- Modify: `components/apartment-map/planning-chat-panel.tsx`
- Modify: `components/apartment-map/target-editor.tsx`
- Modify: `components/apartment-map/corridor-editor.tsx`

**Interfaces:**
- Consumes: `onboardingSteps`, `OnboardingStepId`, `OnboardingHighlightTarget`.
- Produces:
  - `useOnboardingHighlights(): { showOnboardingStep(stepId: OnboardingStepId): void; message: string | null }`
  - stable `data-onboarding-target` attributes.

- [ ] **Step 1: Install Driver.js**

Run:

```bash
npm install driver.js
```

Expected: `package.json` and `package-lock.json` include `driver.js`.

- [ ] **Step 2: Import Driver.js CSS**

Add to `app/globals.css` near the other package CSS imports:

```css
@import "driver.js/dist/driver.css";
```

- [ ] **Step 3: Add highlight hook**

Create `components/apartment-map/use-onboarding-highlights.ts`:

```ts
"use client";

import { useCallback, useRef, useState } from "react";
import { driver, type DriveStep } from "driver.js";

import type { OnboardingStepId } from "@/lib/domain/types";
import { onboardingSteps } from "@/lib/onboarding/steps";

const targetSelectors = {
  apiKey: '[data-onboarding-target="api-key"]',
  planningChatInput: '[data-onboarding-target="planning-chat-input"]',
  proposalCard: '[data-onboarding-target="proposal-card"]',
  anchorEditor: '[data-onboarding-target="anchor-editor"]',
  mapLayers: '[data-onboarding-target="map-layers"]',
  listingCard: '[data-onboarding-target="listing-card"]',
} as const;

export function useOnboardingHighlights() {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const showOnboardingStep = useCallback((stepId: OnboardingStepId) => {
    const step = onboardingSteps.find((item) => item.id === stepId);
    if (!step) {
      return;
    }

    const selector = targetSelectors[step.highlightTarget];
    const element = document.querySelector(selector);
    if (!element) {
      setMessage(missingTargetMessage(stepId));
      return;
    }

    driverRef.current?.destroy();
    const driverObj = driver({
      allowClose: true,
      animate: true,
      showButtons: ["close"],
      onDestroyStarted: () => {
        driverObj.destroy();
      },
    });
    driverRef.current = driverObj;
    setMessage(null);

    const driveStep: DriveStep = {
      element: selector,
      popover: {
        title: step.title,
        description: step.description,
      },
    };
    driverObj.highlight(driveStep);
  }, []);

  return { message, showOnboardingStep };
}

function missingTargetMessage(stepId: OnboardingStepId) {
  if (stepId === "apply_map_suggestion") {
    return "Ask chat for a map suggestion first.";
  }

  if (stepId === "edit_anchor_meaning") {
    return "Select a pin or corridor to edit it.";
  }

  if (stepId === "review_listing") {
    return "Ask for listings first.";
  }

  return "Open the relevant sidebar section first.";
}
```

- [ ] **Step 4: Add highlight targets**

Add these attributes:

In `components/apartment-map/api-key-dialog.tsx`, on the outer card:

```tsx
data-onboarding-target="api-key"
```

In `components/apartment-map/planning-chat-panel.tsx`, on the chat input:

```tsx
data-onboarding-target="planning-chat-input"
```

On proposal card root article/div:

```tsx
data-onboarding-target="proposal-card"
```

On listing card root article:

```tsx
data-onboarding-target="listing-card"
```

In `components/apartment-map/target-editor.tsx` and `components/apartment-map/corridor-editor.tsx`, on the outer section:

```tsx
data-onboarding-target="anchor-editor"
```

In `components/apartment-map/sidebar.tsx`, on the map layers section:

```tsx
data-onboarding-target="map-layers"
```

- [ ] **Step 5: Wire highlights to apps**

In both `ApartmentMapApp` and `PersistentApartmentMapApp`, call:

```ts
const onboardingHighlights = useOnboardingHighlights();
```

Pass:

```tsx
onShowOnboardingStep={(stepId) => {
  onboarding.setPanelState({ lastHighlightedStepId: stepId });
  onboardingHighlights.showOnboardingStep(stepId);
}}
```

Pass `onboardingHighlights.message` into `Sidebar` and `OnboardingPanel` as an additional inline notice. Update `OnboardingPanel` props:

```ts
highlightMessage: string | null;
```

Render:

```tsx
{highlightMessage ? <p className="mt-3 text-xs text-muted-foreground">{highlightMessage}</p> : null}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add package.json package-lock.json app/globals.css components/apartment-map/use-onboarding-highlights.ts components/apartment-map/sidebar.tsx components/apartment-map/api-key-dialog.tsx components/apartment-map/planning-chat-panel.tsx components/apartment-map/target-editor.tsx components/apartment-map/corridor-editor.tsx components/apartment-map/apartment-map-app.tsx components/apartment-map/persistent-apartment-map-app.tsx
git commit -m "Add onboarding highlights"
```

---

### Task 6: Workflow Milestones And Completion Wiring

**Files:**
- Modify: `components/apartment-map/planning-chat-panel.tsx`
- Modify: `components/apartment-map/target-editor.tsx`
- Modify: `components/apartment-map/corridor-editor.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `components/apartment-map/persistent-apartment-map-app.tsx`
- Test: `tests/e2e/apartment-map.spec.ts`

**Interfaces:**
- Produces:
  - `PlanningChatOnboardingMilestone`
  - `AnchorSemanticEdit`
  - completion calls for `ask_for_anchors`, `ask_for_listings`, `apply_map_suggestion`, `edit_anchor_meaning`, and `review_listing`.

- [ ] **Step 1: Add milestone types**

In `components/apartment-map/planning-chat-panel.tsx`, export:

```ts
export type PlanningChatOnboardingMilestone =
  | {
      kind: "anchorProposalReceived";
      messageId: string;
      proposalType: "mapProposal" | "targetEditProposal";
    }
  | { kind: "listingResultsReceived"; messageId: string; resultSetId: string };
```

Add prop:

```ts
onOnboardingMilestone?: (milestone: PlanningChatOnboardingMilestone) => void;
```

- [ ] **Step 2: Emit chat milestones after accepted responses**

In the planning chat submit success path, after parsing and accepting the response into the thread cache, inspect `response.assistantMessage.parts`:

```ts
for (const part of response.assistantMessage.parts) {
  if (part.type === "mapProposal" || part.type === "targetEditProposal") {
    onOnboardingMilestone?.({
      kind: "anchorProposalReceived",
      messageId: response.assistantMessage.id,
      proposalType: part.type,
    });
  }

  if (part.type === "listingResults") {
    onOnboardingMilestone?.({
      kind: "listingResultsReceived",
      messageId: response.assistantMessage.id,
      resultSetId: part.resultSetId,
    });
  }
}
```

- [ ] **Step 3: Add semantic edit types and editor callbacks**

In `components/apartment-map/target-editor.tsx`, export:

```ts
export type AnchorSemanticEdit =
  | {
      kind: "target";
      targetId: string;
      field: "purpose" | "influence" | "priority" | "radiusMinutes" | "notes" | "name";
    }
  | {
      kind: "corridor";
      corridorId: string;
      field: "name" | "priority" | "tags" | "notes";
    };
```

Add prop:

```ts
onSemanticEdit?: (edit: AnchorSemanticEdit) => void;
```

After each successful `nextState`, call:

```ts
onSemanticEdit?.({ kind: "target", targetId: target.id, field: "purpose" });
```

Use the matching field in `commitPurpose`, `commitName`, `commitNotes`, and `commitSelectField`.

In `components/apartment-map/corridor-editor.tsx`, import `AnchorSemanticEdit` from `target-editor`, add the same prop, and emit:

```ts
onSemanticEdit?.({ kind: "corridor", corridorId: corridor.id, field: "name" });
```

Use the matching field in `commitName`, `commitPriority`, `commitTag`, and `commitNotes`.

- [ ] **Step 4: Forward callbacks through Sidebar**

In `components/apartment-map/sidebar.tsx`, add props:

```ts
onPlanningChatOnboardingMilestone: (milestone: PlanningChatOnboardingMilestone) => void;
onAnchorSemanticEdit: (edit: AnchorSemanticEdit) => void;
```

Pass `onAnchorSemanticEdit` to `TargetEditor` and `CorridorEditor`. Pass `onPlanningChatOnboardingMilestone` to `PlanningChatPanel`.

- [ ] **Step 5: Complete steps in app containers**

In both app containers, implement:

```ts
function handlePlanningChatOnboardingMilestone(milestone: PlanningChatOnboardingMilestone) {
  if (milestone.kind === "anchorProposalReceived") {
    onboarding.completeSteps(["ask_for_anchors"]);
    return;
  }

  onboarding.completeSteps(["ask_for_listings"]);
}

function handleAnchorSemanticEdit() {
  onboarding.completeSteps(["edit_anchor_meaning"]);
}
```

In `applyPlanningMapState` or equivalent successful planning action callback, add:

```ts
onboarding.completeSteps(["apply_map_suggestion"]);
```

In `handlePlanningListingLeadChange`, when the lead status is `saved` or `dismissed`, add:

```ts
onboarding.completeSteps(["review_listing"]);
```

In `updateApiKey`, when `nextApiKey` is present, add:

```ts
onboarding.completeSteps(["set_ai_key"]);
```

- [ ] **Step 6: Run focused checks**

Run:

```bash
npm run typecheck
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add components/apartment-map/planning-chat-panel.tsx components/apartment-map/target-editor.tsx components/apartment-map/corridor-editor.tsx components/apartment-map/sidebar.tsx components/apartment-map/apartment-map-app.tsx components/apartment-map/persistent-apartment-map-app.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Wire onboarding milestones"
```

---

### Task 7: End-To-End Coverage And Final Verification

**Files:**
- Modify: `tests/e2e/apartment-map.spec.ts`
- Modify: `tests/e2e/persistent-workspace.spec.ts`
- Modify: `docs/superpowers/specs/2026-06-24-task-based-onboarding-design.md` only if implementation reveals a necessary spec correction.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: complete regression coverage for signed-out and signed-in onboarding.

- [ ] **Step 1: Add signed-out e2e tests**

Append tests to `tests/e2e/apartment-map.spec.ts` using existing route stubs and helpers:

```ts
test("task-based onboarding completes local workflow milestones", async ({ page }) => {
  await page.route("**/api/ai/planning-chat", async (route) => {
    const body = route.request().postDataJSON() as { message: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        body.message.includes("listing")
          ? createPlanningChatListingResponse()
          : createPlanningChatMapProposalResponse(),
      ),
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
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
  await saveOpenAiKeyThroughUi(page);
  await expect(page.getByText(/Complete: Add your OpenAI key/)).toBeVisible();

  await page.getByLabel("Ask planning chat").fill("Add pins for all Solidcore locations in SF");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Complete: Ask chat to add pins or corridors/)).toBeVisible();

  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect(page.getByText(/Complete: Review a suggested map change/)).toBeVisible();

  await page.locator(".target-anchor-marker").first().click();
  await page.getByLabel("Target purpose").fill("Favorite workout anchor");
  await page.getByLabel("Target purpose").blur();
  await expect(page.getByText(/Complete: Give an anchor planning meaning/)).toBeVisible();

  await page.getByLabel("Ask planning chat").fill("Find listing near my pins");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Complete: Ask for listings near your priorities/)).toBeVisible();

  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText(/Complete: Save or dismiss a listing/)).toBeVisible();
});
```

- [ ] **Step 2: Add highlight e2e test**

Add:

```ts
test("onboarding show me opens a highlight without completing the step", async ({ page }) => {
  await page.goto("/");

  await page
    .locator("li", { hasText: "Ask chat to add pins or corridors" })
    .getByRole("button", { name: "Show me" })
    .click();

  await expect(page.locator(".driver-popover")).toBeVisible();
  await expect(page.getByText(/Complete: Ask chat to add pins or corridors/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".driver-popover")).toHaveCount(0);
});
```

- [ ] **Step 3: Add signed-in persistence e2e test**

In `tests/e2e/persistent-workspace.spec.ts`, add a test that stubs the workspace client-state with `workspace.onboardingProgress`, stubs `PUT /api/workspace/onboarding`, completes one step, refreshes, and verifies the completed step remains visible from server state.

Use the existing persistent-workspace route stubbing style. The expected request body for a completion should be:

```ts
{
  operation: {
    type: "completeSteps",
    stepIds: ["set_ai_key"],
  },
}
```

- [ ] **Step 4: Run full relevant verification**

Run:

```bash
npm run test -- tests/unit/onboarding-progress.test.ts tests/unit/onboarding-storage.test.ts tests/unit/workspace-onboarding.test.ts tests/routes/workspace-onboarding-route.test.ts tests/routes/workspace-route.test.ts
npm run typecheck
npm run lint
npm run test:e2e -- tests/e2e/apartment-map.spec.ts tests/e2e/persistent-workspace.spec.ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 7**

```bash
git add tests/e2e/apartment-map.spec.ts tests/e2e/persistent-workspace.spec.ts docs/superpowers/specs/2026-06-24-task-based-onboarding-design.md
git commit -m "Test onboarding workflow"
```

---

## Self-Review Checklist

- Spec coverage: Tasks cover domain model, local persistence, workspace DB persistence, atomic merge, route failures, sidebar panel, Driver.js highlights, chat/editor milestones, signed-out and signed-in E2E flows.
- Placeholder scan: This plan intentionally avoids deferred implementation markers and includes exact file paths, interfaces, commands, and expected outcomes.
- Type consistency: `OnboardingStepId`, `OnboardingProgress`, `OnboardingOperation`, `PlanningChatOnboardingMilestone`, and `AnchorSemanticEdit` are introduced before downstream tasks consume them.
- Isolation: Each task has its own tests and commit.
