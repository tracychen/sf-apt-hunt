# Target Planning Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn target pins into editable planning anchors with free-text purpose, influence, radius, assistant proposal support, drag-safe labels, and undoable sidebar edits.

**Architecture:** Keep `MapState` as the single source of truth. Add target planning fields to the shared domain contract, migrate old browser-stored targets on load, and reuse `ApartmentMapApp.updateMapState` so drag edits, sidebar edits, and accepted proposals share the same storage/history path.

**Tech Stack:** Next.js App Router, React 19 client components, React Leaflet 5, Leaflet Geoman, TypeScript, Zod 4, Vitest, Playwright.

---

## File Structure

- Modify `lib/domain/types.ts`: add target planning field types and `updateTargetPlanningFields`.
- Modify `lib/domain/schemas.ts`: validate planning fields, migrated targets, and the new proposal operation.
- Modify `lib/map/seed-data.ts`: add planning fields to seed targets.
- Modify `lib/storage/map-storage.ts`: migrate old localStorage target objects before schema validation.
- Create `lib/map/target-points.ts`: pure target helpers for label formatting, radius meters, and planning-field patches.
- Modify `components/apartment-map/leaflet-map-state.ts`: use target helper functions for coordinate and planning-field edits.
- Modify `components/apartment-map/leaflet-map.tsx`: show target labels, influence marker styling, and radius rings.
- Create `components/apartment-map/target-editor.tsx`: selected target sidebar editor.
- Modify `components/apartment-map/sidebar.tsx`: render `TargetEditor` for selected target.
- Modify `components/apartment-map/apartment-map-app.tsx`: pass `onMapStateChange` to the sidebar and keep reset behavior intact.
- Modify `lib/map/proposals.ts`: apply `updateTargetPlanningFields`.
- Modify `components/apartment-map/proposal-review-dialog.tsx`: preview target field updates.
- Modify `app/api/ai/map-assistant/route.ts`: update strict OpenAI JSON schema and null normalization.
- Modify tests under `tests/unit`, `tests/routes`, and `tests/e2e`.
- Modify `app/globals.css`: add target marker classes for influence states.

## Task 1: Domain Contract And Seed Data

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Modify: `lib/map/seed-data.ts`
- Test: `tests/unit/domain-schemas.test.ts`
- Test: `tests/unit/seed-data.test.ts`

- [ ] **Step 1: Write failing domain schema tests**

Add these tests to `tests/unit/domain-schemas.test.ts` inside `describe("domain schemas", ...)`:

```ts
  it("validates target planning fields", () => {
    expect(() =>
      targetPointSchema.parse({
        id: "fillmore-california",
        name: "Fillmore & California",
        purpose: "favorite block",
        coordinates: [-122.433, 37.789],
        priority: "high",
        influence: "positive",
        radiusMinutes: 10,
        notes: [],
      }),
    ).not.toThrow();
  });

  it("validates target planning field proposal operations", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "Update a target planning anchor.",
        operations: [
          {
            type: "updateTargetPlanningFields",
            targetId: "valencia-20th",
            purpose: "favorite block",
            influence: "positive",
            radiusMinutes: 15,
            reason: "This point should describe why it matters.",
          },
        ],
        confidence: "high",
        requiresUserReview: true,
      }),
    ).not.toThrow();
  });

  it("rejects target planning field proposal operations without a field change", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "No target field changes.",
        operations: [
          {
            type: "updateTargetPlanningFields",
            targetId: "valencia-20th",
            reason: "No editable field was supplied.",
          },
        ],
        confidence: "low",
        requiresUserReview: true,
      }),
    ).toThrow();
  });
```

Update the existing `validates target coordinates as longitude latitude` test so the object includes:

```ts
purpose: "Lower Pac Heights reference point",
influence: "positive",
radiusMinutes: 10,
```

- [ ] **Step 2: Run the domain tests and verify failure**

Run:

```bash
npm run test -- tests/unit/domain-schemas.test.ts tests/unit/seed-data.test.ts
```

Expected: FAIL because `TargetPoint` does not yet contain `purpose`, `influence`, or `radiusMinutes`, and `updateTargetPlanningFields` is not a valid proposal operation.

- [ ] **Step 3: Update TypeScript domain types**

In `lib/domain/types.ts`, add these exported types near `Priority`:

```ts
export type TargetInfluence = "positive" | "negative" | "neutral";

export type TargetRadiusMinutes = 5 | 10 | 15 | 20;
```

Update `TargetPoint`:

```ts
export type TargetPoint = {
  id: string;
  name: string;
  purpose: string;
  coordinates: Coordinate;
  priority: Priority;
  influence: TargetInfluence;
  radiusMinutes: TargetRadiusMinutes;
  notes: string[];
};
```

Add this union member to `MapPatchProposal["operations"]` after `updateTargetPriority`:

```ts
    | {
        type: "updateTargetPlanningFields";
        targetId: string;
        name?: string;
        purpose?: string;
        influence?: TargetInfluence;
        priority?: Priority;
        radiusMinutes?: TargetRadiusMinutes;
        notes?: string[];
        reason: string;
      }
```

- [ ] **Step 4: Update Zod schemas**

In `lib/domain/schemas.ts`, add these schemas after `prioritySchema`:

```ts
const targetInfluenceSchema = z.enum(["positive", "negative", "neutral"]);
const targetRadiusMinutesSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
]);
```

Update `targetPointSchema`:

```ts
export const targetPointSchema: z.ZodType<TargetPoint> = z.object({
  id: idSchema,
  name: nameSchema,
  purpose: requiredTextSchema,
  coordinates: coordinateSchema,
  priority: prioritySchema,
  influence: targetInfluenceSchema,
  radiusMinutes: targetRadiusMinutesSchema,
  notes: notesSchema,
});
```

Define this schema before `mapPatchProposalSchema`:

```ts
const updateTargetPlanningFieldsOperationSchema = z.object({
  type: z.literal("updateTargetPlanningFields"),
  targetId: idSchema,
  name: nameSchema.optional(),
  purpose: requiredTextSchema.optional(),
  influence: targetInfluenceSchema.optional(),
  priority: prioritySchema.optional(),
  radiusMinutes: targetRadiusMinutesSchema.optional(),
  notes: notesSchema.optional(),
  reason: requiredTextSchema,
});
```

Add `updateTargetPlanningFieldsOperationSchema` inside the `z.discriminatedUnion("type", [...])` list after `updateTargetPriority`.

Then add this `.superRefine(...)` to the `mapPatchProposalSchema` object after `requiresUserReview: z.literal(true)`:

```ts
}).superRefine((proposal, context) => {
  proposal.operations.forEach((operation, index) => {
    if (operation.type !== "updateTargetPlanningFields") {
      return;
    }

    const hasTargetField =
      operation.name !== undefined ||
      operation.purpose !== undefined ||
      operation.influence !== undefined ||
      operation.priority !== undefined ||
      operation.radiusMinutes !== undefined ||
      operation.notes !== undefined;

    if (!hasTargetField) {
      context.addIssue({
        code: "custom",
        path: ["operations", index],
        message: "At least one target planning field must be provided.",
      });
    }
  });
});
```

- [ ] **Step 5: Update seed targets**

In `lib/map/seed-data.ts`, add planning fields to each target. Use these values:

```ts
{
  id: "fillmore-california",
  name: "Fillmore & California",
  purpose: "Lower Pac Heights reference point",
  coordinates: [-122.433, 37.789],
  priority: "high",
  influence: "positive",
  radiusMinutes: 10,
  notes: ["Lower Pac Heights reference point."],
}
```

```ts
{
  id: "valencia-20th",
  name: "Valencia & 20th",
  purpose: "Mission favorite block",
  coordinates: [-122.421, 37.758],
  priority: "high",
  influence: "positive",
  radiusMinutes: 10,
  notes: ["Mission Dolores / Valencia reference point."],
}
```

```ts
{
  id: "polk-sacramento",
  name: "Polk & Sacramento",
  purpose: "Polk corridor reference point",
  coordinates: [-122.421, 37.792],
  priority: "medium",
  influence: "neutral",
  radiusMinutes: 10,
  notes: ["Polk Gulch reference point."],
}
```

- [ ] **Step 6: Run the domain tests and verify pass**

Run:

```bash
npm run test -- tests/unit/domain-schemas.test.ts tests/unit/seed-data.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/domain/types.ts lib/domain/schemas.ts lib/map/seed-data.ts tests/unit/domain-schemas.test.ts tests/unit/seed-data.test.ts
git commit -m "Add target planning fields"
```

## Task 2: Stored Map Migration And Target Helpers

**Files:**
- Create: `lib/map/target-points.ts`
- Modify: `lib/storage/map-storage.ts`
- Test: `tests/unit/storage.test.ts`
- Test: `tests/unit/target-points.test.ts`

- [ ] **Step 1: Write failing target helper tests**

Create `tests/unit/target-points.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  formatTargetLabel,
  targetRadiusMeters,
} from "@/lib/map/target-points";

describe("target point helpers", () => {
  it("formats purpose and location labels", () => {
    expect(formatTargetLabel({ purpose: "favorite block", name: "Valencia & 20th" })).toBe(
      "favorite block · Valencia & 20th",
    );
  });

  it("deduplicates migrated purpose and name labels", () => {
    expect(formatTargetLabel({ purpose: "Valencia & 20th", name: "Valencia & 20th" })).toBe(
      "Valencia & 20th",
    );
  });

  it("uses 80 meters per walking minute for planning rings", () => {
    expect(targetRadiusMeters({ radiusMinutes: 15 })).toBe(1200);
  });
});
```

- [ ] **Step 2: Write failing storage migration test**

Add this test to `tests/unit/storage.test.ts` inside `describe("map storage", ...)`:

```ts
  it("migrates legacy target points when loading stored map state", () => {
    const localStorage = new FakeStorage();
    const legacyState = {
      ...validMapState,
      targets: [
        {
          id: "fillmore-california",
          name: "Fillmore & California",
          coordinates: [-122.433, 37.789],
          priority: "medium",
          notes: [],
        },
      ],
    };
    localStorage.setItem(mapStateStorageKey, JSON.stringify(legacyState));

    expect(loadMapState(localStorage)?.targets[0]).toEqual({
      id: "fillmore-california",
      name: "Fillmore & California",
      purpose: "Fillmore & California",
      coordinates: [-122.433, 37.789],
      priority: "medium",
      influence: "positive",
      radiusMinutes: 10,
      notes: [],
    });
  });
```

Update `validMapState.targets[0]` in `tests/unit/storage.test.ts` to include the new fields:

```ts
purpose: "favorite block",
influence: "positive",
radiusMinutes: 10,
```

- [ ] **Step 3: Run helper and storage tests and verify failure**

Run:

```bash
npm run test -- tests/unit/target-points.test.ts tests/unit/storage.test.ts
```

Expected: FAIL because `lib/map/target-points.ts` does not exist and legacy targets are rejected by `mapStateSchema`.

- [ ] **Step 4: Add target helper module**

Create `lib/map/target-points.ts`:

```ts
import type {
  MapState,
  TargetInfluence,
  TargetPoint,
  TargetRadiusMinutes,
} from "@/lib/domain/types";

export const WALKING_METERS_PER_MINUTE = 80;

export type TargetPlanningFieldPatch = Partial<
  Pick<TargetPoint, "name" | "purpose" | "influence" | "priority" | "radiusMinutes" | "notes">
>;

export function formatTargetLabel(target: Pick<TargetPoint, "purpose" | "name">) {
  const purpose = target.purpose.trim();
  const name = target.name.trim();

  if (purpose.length === 0 || purpose === name) {
    return name;
  }

  if (name.length === 0) {
    return purpose;
  }

  return `${purpose} · ${name}`;
}

export function targetRadiusMeters(target: Pick<TargetPoint, "radiusMinutes">) {
  return target.radiusMinutes * WALKING_METERS_PER_MINUTE;
}

export function applyTargetPlanningFieldPatch(
  mapState: MapState,
  targetId: string,
  patch: TargetPlanningFieldPatch,
) {
  const target = mapState.targets.find((item) => item.id === targetId);

  if (!target) {
    return null;
  }

  const nextTarget = { ...target };

  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) {
      Object.assign(nextTarget, { [field]: value });
    }
  }

  if (targetsEqual(target, nextTarget)) {
    return null;
  }

  return {
    ...mapState,
    targets: mapState.targets.map((item) => (item.id === targetId ? nextTarget : item)),
  };
}

export function isTargetInfluence(value: unknown): value is TargetInfluence {
  return value === "positive" || value === "negative" || value === "neutral";
}

export function isTargetRadiusMinutes(value: unknown): value is TargetRadiusMinutes {
  return value === 5 || value === 10 || value === 15 || value === 20;
}

function targetsEqual(left: TargetPoint, right: TargetPoint) {
  return (
    left.name === right.name &&
    left.purpose === right.purpose &&
    left.influence === right.influence &&
    left.priority === right.priority &&
    left.radiusMinutes === right.radiusMinutes &&
    left.notes.length === right.notes.length &&
    left.notes.every((note, index) => note === right.notes[index])
  );
}
```

- [ ] **Step 5: Add stored map migration**

In `lib/storage/map-storage.ts`, update imports:

```ts
import type { MapState, Priority } from "@/lib/domain/types";
import {
  isTargetInfluence,
  isTargetRadiusMinutes,
} from "@/lib/map/target-points";
```

Add these helpers before `saveMapState`:

```ts
function migrateStoredMapState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.targets)) {
    return value;
  }

  return {
    ...state,
    targets: state.targets.map(migrateStoredTarget),
  };
}

function migrateStoredTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const target = value as Record<string, unknown>;
  const name = typeof target.name === "string" ? target.name : "";
  const purpose = typeof target.purpose === "string" && target.purpose.trim()
    ? target.purpose
    : name;
  const priority = isPriority(target.priority) ? target.priority : "medium";

  return {
    ...target,
    purpose,
    priority,
    influence: isTargetInfluence(target.influence) ? target.influence : "positive",
    radiusMinutes: isTargetRadiusMinutes(target.radiusMinutes) ? target.radiusMinutes : 10,
  };
}

function isPriority(value: unknown): value is Priority {
  return value === "high" || value === "medium" || value === "low";
}
```

Update `loadMapState`:

```ts
  const parsedState = parseJson(rawState.value);
  const result = mapStateSchema.safeParse(migrateStoredMapState(parsedState));
  return result.success ? result.data : null;
```

- [ ] **Step 6: Run helper and storage tests and verify pass**

Run:

```bash
npm run test -- tests/unit/target-points.test.ts tests/unit/storage.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/map/target-points.ts lib/storage/map-storage.ts tests/unit/target-points.test.ts tests/unit/storage.test.ts
git commit -m "Migrate target planning anchors"
```

## Task 3: Target Coordinate And Field Edit State

**Files:**
- Modify: `components/apartment-map/leaflet-map-state.ts`
- Test: `tests/unit/leaflet-map-state.test.ts`

- [ ] **Step 1: Write failing map-state edit tests**

Add imports in `tests/unit/leaflet-map-state.test.ts`:

```ts
  applyTargetPlanningFieldEdit,
```

Add these tests inside `describe("leaflet map state edits", ...)`:

```ts
  it("renames an untouched seed target when dragged away from its seed location", () => {
    const nextState = applyTargetCoordinateEdit(seedMapState, "valencia-20th", [-122.4225, 37.7595]);

    expect(nextState?.targets.find((target) => target.id === "valencia-20th")?.name).toBe(
      "Custom location",
    );
    expect(nextState?.targets.find((target) => target.id === "valencia-20th")?.purpose).toBe(
      "Mission favorite block",
    );
  });

  it("does not overwrite a manually edited target location label when dragged", () => {
    const editedState = {
      ...seedMapState,
      targets: seedMapState.targets.map((target) =>
        target.id === "valencia-20th" ? { ...target, name: "My favorite Valencia block" } : target,
      ),
    };
    const nextState = applyTargetCoordinateEdit(editedState, "valencia-20th", [-122.4225, 37.7595]);

    expect(nextState?.targets.find((target) => target.id === "valencia-20th")?.name).toBe(
      "My favorite Valencia block",
    );
  });

  it("updates target planning fields", () => {
    const nextState = applyTargetPlanningFieldEdit(seedMapState, "polk-sacramento", {
      purpose: "late-night noise",
      influence: "negative",
      radiusMinutes: 15,
      notes: ["Avoid this area after midnight."],
    });

    expect(nextState?.targets.find((target) => target.id === "polk-sacramento")).toMatchObject({
      purpose: "late-night noise",
      influence: "negative",
      radiusMinutes: 15,
      notes: ["Avoid this area after midnight."],
    });
  });
```

- [ ] **Step 2: Run map-state tests and verify failure**

Run:

```bash
npm run test -- tests/unit/leaflet-map-state.test.ts
```

Expected: FAIL because dragged seed target labels are not changed and `applyTargetPlanningFieldEdit` is not exported.

- [ ] **Step 3: Implement target edit state helpers**

Update imports in `components/apartment-map/leaflet-map-state.ts`:

```ts
import type { Coordinate, MapState } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import {
  applyTargetPlanningFieldPatch,
  type TargetPlanningFieldPatch,
} from "@/lib/map/target-points";
```

Update the target coordinate mapping inside `applyTargetCoordinateEdit`:

```ts
    targets: mapState.targets.map((item) =>
      item.id === targetId
        ? {
            ...item,
            name: shouldUseCustomLocationLabel(item, coordinates) ? "Custom location" : item.name,
            coordinates,
          }
        : item,
    ),
```

Add these functions after `applyTargetCoordinateEdit`:

```ts
export function applyTargetPlanningFieldEdit(
  mapState: MapState,
  targetId: string,
  patch: TargetPlanningFieldPatch,
): PersistResult {
  return applyTargetPlanningFieldPatch(mapState, targetId, patch);
}

function shouldUseCustomLocationLabel(
  target: MapState["targets"][number],
  coordinates: Coordinate,
) {
  const seedTarget = seedMapState.targets.find((item) => item.id === target.id);

  return Boolean(
    seedTarget &&
      target.name === seedTarget.name &&
      !coordinateEqual(seedTarget.coordinates, coordinates),
  );
}
```

- [ ] **Step 4: Run map-state tests and verify pass**

Run:

```bash
npm run test -- tests/unit/leaflet-map-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/apartment-map/leaflet-map-state.ts tests/unit/leaflet-map-state.test.ts
git commit -m "Add target planning field edits"
```

## Task 4: Assistant Proposal Contract

**Files:**
- Modify: `lib/map/proposals.ts`
- Modify: `components/apartment-map/proposal-review-dialog.tsx`
- Modify: `app/api/ai/map-assistant/route.ts`
- Test: `tests/unit/map-proposals.test.ts`
- Test: `tests/routes/map-assistant-route.test.ts`
- Test: `tests/routes/apply-proposal-route.test.ts`

- [ ] **Step 1: Write failing proposal apply tests**

Add this test to `tests/unit/map-proposals.test.ts`:

```ts
  it("updates target planning fields by ID", () => {
    const result = applyProposal(seedMapState, {
      summary: "Clarify Valencia target.",
      operations: [
        {
          type: "updateTargetPlanningFields",
          targetId: "valencia-20th",
          purpose: "favorite dinner and fitness block",
          name: "Valencia near 20th",
          influence: "positive",
          priority: "high",
          radiusMinutes: 15,
          notes: ["Use as a planning anchor for Mission listings."],
          reason: "The current pin needs planning context.",
        },
      ],
      confidence: "high",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.targets.find((target) => target.id === "valencia-20th")).toMatchObject({
        purpose: "favorite dinner and fitness block",
        name: "Valencia near 20th",
        influence: "positive",
        priority: "high",
        radiusMinutes: 15,
        notes: ["Use as a planning anchor for Mission listings."],
      });
    }
  });
```

- [ ] **Step 2: Update existing addTarget fixtures**

In `tests/unit/map-proposals.test.ts`, every inline `target` object in an `addTarget` operation must include these fields:

```ts
purpose: "Test planning anchor",
influence: "positive",
radiusMinutes: 10,
```

For the `bad` target in the invalid-coordinate test, use:

```ts
purpose: "Invalid test planning anchor",
influence: "neutral",
radiusMinutes: 10,
```

In `tests/routes/apply-proposal-route.test.ts`, update `createStateAtTargetLimit` filler targets:

```ts
      purpose: `Limit Target ${index}`,
      influence: "neutral",
      radiusMinutes: 10,
```

In the `target-over-limit` proposal, add:

```ts
purpose: "Target over limit",
influence: "neutral",
radiusMinutes: 10,
```

- [ ] **Step 3: Write failing map-assistant route tests**

Add this assertion to the existing `sends store false to OpenAI and parses a valid proposal response` test in `tests/routes/map-assistant-route.test.ts`:

```ts
    expect(JSON.stringify(payload)).toContain('"type":{"const":"updateTargetPlanningFields"}');
    expect(JSON.stringify(payload)).toContain('"purpose":{"anyOf":[{"type":"string","minLength":1,"maxLength":2000},{"type":"null"}]}');
```

Add this test to `tests/routes/map-assistant-route.test.ts`:

```ts
  it("parses addTarget proposals with target planning fields", async () => {
    const proposalResponse = {
      explanation: "I found one new target worth reviewing.",
      intent: "map_edit",
      proposal: {
        summary: "Add a Divisadero grocery target.",
        operations: [
          {
            type: "addTarget",
            target: {
              id: "divisadero-grocery",
              name: "Divisadero grocery",
              purpose: "easy grocery run",
              coordinates: [-122.437, 37.776],
              priority: "medium",
              influence: "positive",
              radiusMinutes: 10,
              notes: ["Useful errand anchor for NOPA."],
            },
          },
        ],
        confidence: "medium",
        requiresUserReview: true,
      },
      confidence: "medium",
      caveats: [],
    };
    mockOpenAiResponse({ output_text: JSON.stringify(proposalResponse) });

    const response = await POST(
      createRequest(
        {
          message: "Add a grocery target near Divisadero.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );

    await expect(response.json()).resolves.toEqual(proposalResponse);
    expect(response.status).toBe(200);
  });

  it("normalizes null updateTargetPlanningFields fields from structured output", async () => {
    mockOpenAiResponse({
      output_text: JSON.stringify({
        explanation: "I found one target update worth reviewing.",
        intent: "prioritization",
        proposal: {
          summary: "Update Valencia target purpose.",
          operations: [
            {
              type: "updateTargetPlanningFields",
              targetId: "valencia-20th",
              name: null,
              purpose: "favorite block",
              influence: null,
              priority: null,
              radiusMinutes: 15,
              notes: null,
              reason: "The pin should carry planning context.",
            },
          ],
          confidence: "medium",
          requiresUserReview: true,
        },
        confidence: "medium",
        caveats: [],
      }),
    });

    const response = await POST(
      createRequest(
        {
          message: "Make Valencia a favorite block target.",
          mapState: seedMapState,
        },
        "Bearer sk-test-map",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.operations).toEqual([
      {
        type: "updateTargetPlanningFields",
        targetId: "valencia-20th",
        purpose: "favorite block",
        radiusMinutes: 15,
        reason: "The pin should carry planning context.",
      },
    ]);
  });
```

- [ ] **Step 4: Run proposal tests and verify failure**

Run:

```bash
npm run test -- tests/unit/map-proposals.test.ts tests/routes/map-assistant-route.test.ts tests/routes/apply-proposal-route.test.ts
```

Expected: FAIL because proposals cannot update target planning fields and the OpenAI JSON schema does not include the new fields.

- [ ] **Step 5: Apply target planning field proposals**

Update imports in `lib/map/proposals.ts`:

```ts
import { applyTargetPlanningFieldPatch } from "@/lib/map/target-points";
```

Add this switch case after `updateTargetPriority`:

```ts
      case "updateTargetPlanningFields": {
        if (!nextState.targets.some((target) => target.id === operation.targetId)) {
          return { ok: false, error: "Unknown target ID." };
        }

        const nextTargetState = applyTargetPlanningFieldPatch(nextState, operation.targetId, {
          name: operation.name,
          purpose: operation.purpose,
          influence: operation.influence,
          priority: operation.priority,
          radiusMinutes: operation.radiusMinutes,
          notes: operation.notes,
        });

        if (!nextTargetState) {
          return { ok: false, error: "Target planning fields did not change." };
        }

        nextState = nextTargetState;
        break;
      }
```

- [ ] **Step 6: Preview target planning field proposals**

In `components/apartment-map/proposal-review-dialog.tsx`, add this case to `describeOperation`:

```ts
    case "updateTargetPlanningFields":
      return `Update target planning fields: ${operation.targetId}`;
```

Add this case to `operationPreview`:

```ts
    case "updateTargetPlanningFields": {
      const target = mapState.targets.find((item) => item.id === operation.targetId);
      if (!target) {
        return "Planning field preview unavailable for unknown target.";
      }

      return [
        operation.name !== undefined ? `name ${target.name}->${operation.name}` : null,
        operation.purpose !== undefined ? `purpose ${target.purpose}->${operation.purpose}` : null,
        operation.influence !== undefined ? `influence ${target.influence}->${operation.influence}` : null,
        operation.priority !== undefined ? `priority ${target.priority}->${operation.priority}` : null,
        operation.radiusMinutes !== undefined
          ? `radius ${target.radiusMinutes}->${operation.radiusMinutes} min`
          : null,
        operation.notes !== undefined ? `notes ${target.notes.length}->${operation.notes.length}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    }
```

- [ ] **Step 7: Update the strict OpenAI JSON schema**

In `app/api/ai/map-assistant/route.ts`, add:

```ts
const nullableTextJsonSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 2000 }, { type: "null" }],
};
const nullableNameJsonSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 160 }, { type: "null" }],
};
const targetInfluenceJsonSchema = { enum: ["positive", "negative", "neutral"] };
const nullableTargetInfluenceJsonSchema = {
  anyOf: [targetInfluenceJsonSchema, { type: "null" }],
};
const targetRadiusMinutesJsonSchema = { enum: [5, 10, 15, 20] };
const nullableTargetRadiusMinutesJsonSchema = {
  anyOf: [targetRadiusMinutesJsonSchema, { type: "null" }],
};
const nullablePriorityJsonSchema = {
  anyOf: [priorityJsonSchema, { type: "null" }],
};
const nullableTextArrayJsonSchema = {
  anyOf: [textArrayJsonSchema, { type: "null" }],
};
```

Update `targetPointJsonSchema.required`:

```ts
required: ["id", "name", "purpose", "coordinates", "priority", "influence", "radiusMinutes", "notes"],
```

Update `targetPointJsonSchema.properties`:

```ts
purpose: { type: "string", minLength: 1, maxLength: 2000 },
influence: targetInfluenceJsonSchema,
radiusMinutes: targetRadiusMinutesJsonSchema,
```

Add this operation schema after `updateTargetPriority`:

```ts
          {
            type: "object",
            additionalProperties: false,
            required: [
              "type",
              "targetId",
              "name",
              "purpose",
              "influence",
              "priority",
              "radiusMinutes",
              "notes",
              "reason",
            ],
            properties: {
              type: { const: "updateTargetPlanningFields" },
              targetId: { type: "string", minLength: 1, maxLength: 128 },
              name: nullableNameJsonSchema,
              purpose: nullableTextJsonSchema,
              influence: nullableTargetInfluenceJsonSchema,
              priority: nullablePriorityJsonSchema,
              radiusMinutes: nullableTargetRadiusMinutesJsonSchema,
              notes: nullableTextArrayJsonSchema,
              reason: { type: "string", minLength: 1, maxLength: 2000 },
            },
          },
```

- [ ] **Step 8: Normalize nullable target fields**

Replace `normalizeMapPatchOperation` with:

```ts
function normalizeMapPatchOperation(operation: unknown) {
  if (!isRecord(operation)) {
    return operation;
  }

  if (operation.type === "updateZoneScores") {
    return omitNullFields(operation, ["fitnessScore", "affordabilityScore", "carFreeScore"]);
  }

  if (operation.type === "updateTargetPlanningFields") {
    return omitNullFields(operation, [
      "name",
      "purpose",
      "influence",
      "priority",
      "radiusMinutes",
      "notes",
    ]);
  }

  return operation;
}

function omitNullFields<TField extends string>(
  operation: Record<string, unknown>,
  fields: readonly TField[],
) {
  const normalizedOperation = { ...operation };

  for (const field of fields) {
    if (normalizedOperation[field] === null) {
      delete normalizedOperation[field];
    }
  }

  return normalizedOperation;
}
```

- [ ] **Step 9: Run proposal tests and verify pass**

Run:

```bash
npm run test -- tests/unit/map-proposals.test.ts tests/routes/map-assistant-route.test.ts tests/routes/apply-proposal-route.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/map/proposals.ts components/apartment-map/proposal-review-dialog.tsx app/api/ai/map-assistant/route.ts tests/unit/map-proposals.test.ts tests/routes/map-assistant-route.test.ts tests/routes/apply-proposal-route.test.ts
git commit -m "Support target planning proposals"
```

## Task 5: Map Labels, Influence Markers, And Radius Rings

**Files:**
- Modify: `components/apartment-map/leaflet-map.tsx`
- Modify: `app/globals.css`
- Test: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Add an e2e assertion for target labels and radius rings**

Add this test to `tests/e2e/apartment-map.spec.ts`:

```ts
test("target planning anchors show purpose labels and radius rings", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".target-anchor-radius")).toHaveCount(3);
  await expect(page.locator(".target-anchor-marker-positive").first()).toBeVisible();
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e test and verify failure**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: FAIL because radius rings and target influence marker classes are not rendered.

- [ ] **Step 3: Update Leaflet target rendering**

In `components/apartment-map/leaflet-map.tsx`, add `Circle` to the `react-leaflet` import:

```ts
  Circle,
```

Update the domain imports:

```ts
import type {
  Coordinate,
  ListingCandidate,
  MapState,
  Priority,
  TargetInfluence,
  TargetPoint,
} from "@/lib/domain/types";
import {
  formatTargetLabel,
  targetRadiusMeters,
} from "@/lib/map/target-points";
```

Add these helpers near `corridorPathOptions`:

```ts
function targetInfluenceColor(influence: TargetInfluence) {
  if (influence === "negative") {
    return "#dc2626";
  }

  if (influence === "neutral") {
    return "#475569";
  }

  return "#0f766e";
}

function targetRadiusPathOptions(target: TargetPoint, selected: boolean): PathOptions {
  const color = targetInfluenceColor(target.influence);

  return {
    color,
    fillColor: color,
    fillOpacity: selected ? 0.12 : 0.07,
    opacity: selected ? 0.55 : 0.35,
    weight: selected ? 2 : 1,
  };
}

function targetMarkerIcon(target: TargetPoint, selected: boolean) {
  return L.divIcon({
    className: [
      "target-anchor-marker",
      `target-anchor-marker-${target.influence}`,
      selected ? "target-anchor-marker-selected" : "",
    ].filter(Boolean).join(" "),
    html: `<span aria-hidden="true"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
}
```

Update `TargetMarker` props to accept `target: TargetPoint` instead of `targetId` and `title`. Inside the marker, use:

```tsx
    applyTargetCoordinateEdit(currentMapState, target.id, fromLatLng(layer.getLatLng())),
```

Render the marker with:

```tsx
      icon={targetMarkerIcon(target, selected)}
      title={formatTargetLabel(target)}
```

Update the target map loop to compute `selected`, `label`, and render a radius ring:

```tsx
        {visibleLayers.targets ? mapState.targets.map((target) => {
          const selected = selectedEntity?.kind === "target" && selectedEntity.id === target.id;
          const label = formatTargetLabel(target);

          return (
            <React.Fragment key={target.id}>
              <Circle
                center={toLatLng(target.coordinates)}
                className="target-anchor-radius"
                interactive={false}
                pathOptions={targetRadiusPathOptions(target, selected)}
                radius={targetRadiusMeters(target)}
              />
              <TargetMarker
                mapState={mapState}
                onMapStateChange={onMapStateChange}
                onSelect={() => onSelectedEntityChange({ kind: "target", id: target.id })}
                position={toLatLng(target.coordinates)}
                selected={selected}
                target={target}
              >
                <Tooltip sticky>{label}</Tooltip>
                <Popup>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">{label}</p>
                    <p>{target.priority} priority / {target.influence}</p>
                    <p>{target.radiusMinutes} min planning radius</p>
                    <p>{formatCoordinate(target.coordinates)}</p>
                  </div>
                </Popup>
              </TargetMarker>
            </React.Fragment>
          );
        }) : null}
```

Add `Fragment` to the React import or use `React.Fragment` with a `React` import. Prefer:

```ts
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
```

and use `<Fragment key={target.id}>`.

- [ ] **Step 4: Add marker CSS**

In `app/globals.css`, add:

```css
.target-anchor-marker {
  background: transparent;
  border: 0;
}

.target-anchor-marker span {
  display: block;
  width: 18px;
  height: 18px;
  border: 2px solid white;
  box-shadow: 0 1px 4px rgb(0 0 0 / 35%);
}

.target-anchor-marker-positive span {
  background: #0f766e;
}

.target-anchor-marker-negative span {
  background: #dc2626;
}

.target-anchor-marker-neutral span {
  background: #475569;
}

.target-anchor-marker-selected span {
  outline: 3px solid #f97316;
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run e2e test and verify pass**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/apartment-map/leaflet-map.tsx app/globals.css tests/e2e/apartment-map.spec.ts
git commit -m "Render target planning anchors"
```

## Task 6: Selected Target Sidebar Editor

**Files:**
- Create: `components/apartment-map/target-editor.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Test: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Write failing e2e editor test**

Add this test to `tests/e2e/apartment-map.spec.ts`:

```ts
test("edits selected target planning fields from the sidebar", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await expect(page.getByLabel("Target purpose")).toHaveValue("Mission favorite block");

  await page.getByLabel("Target purpose").fill("favorite dinner block");
  await page.getByLabel("Target purpose").blur();
  await page.getByLabel("Target influence").selectOption("negative");
  await page.getByLabel("Target priority").selectOption("medium");
  await page.getByLabel("Target radius").selectOption("15");
  await page.getByLabel("Target notes").fill("Check evening noise before applying.");
  await page.getByLabel("Target notes").blur();

  await expect(page.getByText("favorite dinner block · Valencia & 20th")).toBeVisible();
  await expect(page.getByLabel("Target influence")).toHaveValue("negative");
  await expect(page.getByLabel("Target radius")).toHaveValue("15");
});
```

- [ ] **Step 2: Run the editor e2e test and verify failure**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: FAIL because the sidebar has no target planning editor.

- [ ] **Step 3: Create target editor component**

Create `components/apartment-map/target-editor.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import type { MapState, TargetPoint } from "@/lib/domain/types";
import { applyTargetPlanningFieldEdit } from "@/components/apartment-map/leaflet-map-state";

type TargetEditorProps = {
  mapState: MapState;
  target: TargetPoint;
  onMapStateChange: (state: MapState) => void;
};

export function TargetEditor({ mapState, target, onMapStateChange }: TargetEditorProps) {
  const [purpose, setPurpose] = useState(target.purpose);
  const [name, setName] = useState(target.name);
  const [notes, setNotes] = useState(target.notes.join("\n"));

  useEffect(() => {
    setPurpose(target.purpose);
    setName(target.name);
    setNotes(target.notes.join("\n"));
  }, [target.id, target.name, target.notes, target.purpose]);

  function commitPurpose() {
    const value = purpose.trim();
    if (!value) {
      setPurpose(target.purpose);
      return;
    }

    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, { purpose: value });
    if (nextState) {
      onMapStateChange(nextState);
    }
  }

  function commitName() {
    const value = name.trim();
    if (!value) {
      setName(target.name);
      return;
    }

    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, { name: value });
    if (nextState) {
      onMapStateChange(nextState);
    }
  }

  function commitNotes() {
    const nextNotes = notes
      .split("\n")
      .map((note) => note.trim())
      .filter(Boolean);
    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, { notes: nextNotes });

    if (nextState) {
      onMapStateChange(nextState);
    }
  }

  function commitSelectField(
    field: "influence" | "priority" | "radiusMinutes",
    value: string,
  ) {
    const patch =
      field === "radiusMinutes"
        ? { radiusMinutes: Number(value) as TargetPoint["radiusMinutes"] }
        : field === "influence"
          ? { influence: value as TargetPoint["influence"] }
          : { priority: value as TargetPoint["priority"] };
    const nextState = applyTargetPlanningFieldEdit(mapState, target.id, patch);

    if (nextState) {
      onMapStateChange(nextState);
    }
  }

  return (
    <section className="border border-sidebar-border bg-background p-3 text-sm">
      <h2 className="font-medium">Selected target</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-medium" htmlFor="target-purpose">
          Purpose
        </label>
        <input
          id="target-purpose"
          aria-label="Target purpose"
          className="w-full border border-input bg-background p-2 text-sm"
          value={purpose}
          onBlur={commitPurpose}
          onChange={(event) => setPurpose(event.target.value)}
        />

        <label className="block text-xs font-medium" htmlFor="target-name">
          Location label
        </label>
        <input
          id="target-name"
          aria-label="Target location label"
          className="w-full border border-input bg-background p-2 text-sm"
          value={name}
          onBlur={commitName}
          onChange={(event) => setName(event.target.value)}
        />

        <label className="block text-xs font-medium" htmlFor="target-influence">
          Influence
        </label>
        <select
          id="target-influence"
          aria-label="Target influence"
          className="w-full border border-input bg-background p-2 text-sm"
          value={target.influence}
          onChange={(event) => commitSelectField("influence", event.target.value)}
        >
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="neutral">Neutral</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="target-priority">
          Priority
        </label>
        <select
          id="target-priority"
          aria-label="Target priority"
          className="w-full border border-input bg-background p-2 text-sm"
          value={target.priority}
          onChange={(event) => commitSelectField("priority", event.target.value)}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="target-radius">
          Radius
        </label>
        <select
          id="target-radius"
          aria-label="Target radius"
          className="w-full border border-input bg-background p-2 text-sm"
          value={String(target.radiusMinutes)}
          onChange={(event) => commitSelectField("radiusMinutes", event.target.value)}
        >
          <option value="5">5 minutes</option>
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
          <option value="20">20 minutes</option>
        </select>

        <label className="block text-xs font-medium" htmlFor="target-notes">
          Notes
        </label>
        <textarea
          id="target-notes"
          aria-label="Target notes"
          className="min-h-24 w-full border border-input bg-background p-2 text-sm"
          value={notes}
          onBlur={commitNotes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Coordinates: {target.coordinates[1].toFixed(5)}, {target.coordinates[0].toFixed(5)}
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire editor into sidebar**

In `components/apartment-map/sidebar.tsx`, import:

```ts
import { TargetEditor } from "@/components/apartment-map/target-editor";
```

Add prop:

```ts
onMapStateChange: (state: MapState) => void;
```

Destructure it from `Sidebar` props. Before rendering `ApiKeyDialog`, add:

```tsx
        {selectedEntity?.kind === "target" ? (
          <TargetEditor
            mapState={mapState}
            target={mapState.targets.find((target) => target.id === selectedEntity.id) ?? mapState.targets[0]}
            onMapStateChange={onMapStateChange}
          />
        ) : null}
```

Immediately after this change, replace the fallback expression with a safe local variable before `return`:

```ts
  const selectedTarget =
    selectedEntity?.kind === "target"
      ? mapState.targets.find((target) => target.id === selectedEntity.id) ?? null
      : null;
```

Then render:

```tsx
        {selectedTarget ? (
          <TargetEditor
            mapState={mapState}
            target={selectedTarget}
            onMapStateChange={onMapStateChange}
          />
        ) : null}
```

- [ ] **Step 5: Pass map-state updater from app**

In `components/apartment-map/apartment-map-app.tsx`, pass the prop:

```tsx
        onMapStateChange={updateMapState}
```

- [ ] **Step 6: Run editor e2e test and verify pass**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/apartment-map/target-editor.tsx components/apartment-map/sidebar.tsx components/apartment-map/apartment-map-app.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Add target planning editor"
```

## Task 7: Undo, Reset, And Drag Interaction Coverage

**Files:**
- Modify: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Add e2e coverage for undo/reset after target edits**

Add this test to `tests/e2e/apartment-map.spec.ts`:

```ts
test("target field edits are undoable and resettable", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("Mission favorite block · Valencia & 20th").click();
  await page.getByLabel("Target purpose").fill("favorite dinner block");
  await page.getByLabel("Target purpose").blur();
  await expect(page.getByText("favorite dinner block · Valencia & 20th")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Mission favorite block · Valencia & 20th")).toBeVisible();

  await page.getByLabel("Target purpose").fill("favorite dinner block");
  await page.getByLabel("Target purpose").blur();
  await page.getByRole("button", { name: "Reset selected shape" }).click();
  await expect(page.getByText("Mission favorite block · Valencia & 20th")).toBeVisible();
});
```

- [ ] **Step 2: Run target e2e tests**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/apartment-map.spec.ts
git commit -m "Cover target planning undo and reset"
```

## Task 8: Final Verification

**Files:**
- No source changes unless verification exposes a defect.

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run unit and route tests**

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 4: Run e2e tests**

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 5: Run production build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Manual browser verification**

Run:

```bash
npm run dev
```

Expected: the app starts on `http://localhost:3333`.

Open the app in the Codex Browser and verify:

- Target pins have influence-specific markers.
- Each target has a visible radius ring.
- Selecting a target opens the editor.
- Editing purpose updates the marker tooltip/title and sidebar active shape text.
- Editing influence updates marker color.
- Editing radius changes the radius ring size.
- Dragging a seed target changes the location label to `Custom location` while preserving purpose.
- Undo restores the previous target edit.
- Reset selected restores seed target fields.
