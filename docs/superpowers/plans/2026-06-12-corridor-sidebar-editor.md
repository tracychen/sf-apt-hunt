# Corridor Sidebar Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selected-corridor sidebar editor for existing corridor metadata and keep edits persistent, undoable, resettable, and covered by tests.

**Architecture:** Add one corridor metadata patch helper next to the existing map-state edit helpers. Add a focused `CorridorEditor` component that mirrors the target editor's commit path, then wire it into `Sidebar` and clear stale selection when a custom corridor reset removes the selected corridor.

**Tech Stack:** Next.js App Router client components, React 19, TypeScript, Leaflet map state helpers, Vitest unit tests, Playwright e2e tests.

---

### Task 1: Corridor Metadata State Helper

**Files:**
- Modify: `components/apartment-map/leaflet-map-state.ts`
- Modify: `tests/unit/leaflet-map-state.test.ts`

- [ ] **Step 1: Write failing unit tests**

Add the import in `tests/unit/leaflet-map-state.test.ts`:

```ts
import {
  applyCorridorGeometryEdit,
  applyCorridorMetadataEdit,
  applyTargetCoordinateEdit,
  applyTargetPlanningFieldEdit,
  applyZoneGeometryEdit,
} from "@/components/apartment-map/leaflet-map-state";
```

Add these tests inside `describe("leaflet map state edits", () => { ... })`:

```ts
  it("updates corridor metadata fields", () => {
    const nextState = applyCorridorMetadataEdit(seedMapState, "polk", {
      name: "Polk Gulch spine",
      priority: "high",
      tags: ["fitness", "transit", "safety"],
      notes: ["Prioritize north-side services."],
    });

    expect(nextState?.corridors.find((corridor) => corridor.id === "polk")).toMatchObject({
      name: "Polk Gulch spine",
      priority: "high",
      tags: ["fitness", "transit", "safety"],
      notes: ["Prioritize north-side services."],
    });
  });

  it("returns null for unknown corridor metadata edits", () => {
    expect(
      applyCorridorMetadataEdit(seedMapState, "missing-corridor", {
        priority: "high",
      }),
    ).toBeNull();
  });
```

Add this assertion to the existing `"returns null when edited geometry does not change"` test:

```ts
    expect(applyCorridorMetadataEdit(seedMapState, corridor.id, {
      name: corridor.name,
      priority: corridor.priority,
      tags: corridor.tags,
      notes: corridor.notes,
    })).toBeNull();
```

- [ ] **Step 2: Run the unit test to verify RED**

Run:

```bash
npm run test -- tests/unit/leaflet-map-state.test.ts
```

Expected: fail because `applyCorridorMetadataEdit` is not exported.

- [ ] **Step 3: Implement the helper**

In `components/apartment-map/leaflet-map-state.ts`, update the type import:

```ts
import type { Coordinate, MapState, TargetCorridor } from "@/lib/domain/types";
```

Add this exported type and function after `applyCorridorGeometryEdit`:

```ts
export type CorridorMetadataPatch = Partial<
  Pick<TargetCorridor, "name" | "priority" | "tags" | "notes">
>;

export function applyCorridorMetadataEdit(
  mapState: MapState,
  corridorId: string,
  patch: CorridorMetadataPatch,
): PersistResult {
  const corridor = mapState.corridors.find((item) => item.id === corridorId);

  if (!corridor) {
    return null;
  }

  const nextCorridor = { ...corridor };

  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) {
      Object.assign(nextCorridor, { [field]: value });
    }
  }

  if (corridorsEqual(corridor, nextCorridor)) {
    return null;
  }

  return {
    ...mapState,
    corridors: mapState.corridors.map((item) =>
      item.id === corridorId ? nextCorridor : item,
    ),
  };
}
```

Add this private comparator near `shouldUseCustomLocationLabel`:

```ts
function corridorsEqual(left: TargetCorridor, right: TargetCorridor) {
  return (
    left.name === right.name &&
    left.priority === right.priority &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index]) &&
    left.notes.length === right.notes.length &&
    left.notes.every((note, index) => note === right.notes[index])
  );
}
```

- [ ] **Step 4: Run the unit test to verify GREEN**

Run:

```bash
npm run test -- tests/unit/leaflet-map-state.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add components/apartment-map/leaflet-map-state.ts tests/unit/leaflet-map-state.test.ts
git commit -m "Add corridor metadata map-state edit helper"
```

---

### Task 2: Sidebar Corridor Editor and Reset Wiring

**Files:**
- Create: `components/apartment-map/corridor-editor.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Write failing e2e test for selected corridor editor**

Add this test near the target editor e2e tests in `tests/e2e/apartment-map.spec.ts`:

```ts
test("edits selected corridor metadata from the sidebar", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Polk Street").click();
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Street");

  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await page.getByLabel("Corridor priority").selectOption("high");
  await page.getByLabel("Corridor tag transit").check();
  await page.getByLabel("Corridor tag rent").uncheck();
  await page.getByLabel("Corridor notes").fill("Prioritize this north-side run.");
  await page.getByLabel("Corridor notes").blur();

  await expect(page.getByText("Active shape: Polk Gulch spine")).toBeVisible();
  await expect(page.getByLabel("Corridor priority")).toHaveValue("high");
  await expect(page.getByLabel("Corridor tag transit")).toBeChecked();

  await page.reload();
  await page.getByText("Polk Gulch spine").click();
  await expect(page.getByLabel("Corridor notes")).toHaveValue("Prioritize this north-side run.");
});
```

- [ ] **Step 2: Run the e2e test to verify RED**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "edits selected corridor metadata"
```

Expected: fail because the corridor editor fields do not exist.

- [ ] **Step 3: Create `CorridorEditor`**

Create `components/apartment-map/corridor-editor.tsx`:

```tsx
"use client";

import { flushSync } from "react-dom";

import {
  applyCorridorMetadataEdit,
  type CorridorMetadataPatch,
} from "@/components/apartment-map/leaflet-map-state";
import type { MapState, TargetCorridor } from "@/lib/domain/types";

type CorridorEditorProps = {
  mapState: MapState;
  corridor: TargetCorridor;
  onMapStateChange: (state: MapState) => void;
};

const corridorTags = ["fitness", "rent", "transit", "safety", "short-term"] as const;

export function CorridorEditor({ mapState, corridor, onMapStateChange }: CorridorEditorProps) {
  const notesValue = corridor.notes.join("\n");

  function commitName(input: HTMLInputElement) {
    const value = readRequiredText(input, corridor.name);
    if (!value) {
      return;
    }

    commitPatch({ name: value });
  }

  function commitPriority(value: string) {
    if (value !== "high" && value !== "medium" && value !== "low") {
      return;
    }

    commitPatch({ priority: value });
  }

  function commitTag(tag: TargetCorridor["tags"][number], checked: boolean) {
    const nextTags = checked
      ? [...corridor.tags, tag]
      : corridor.tags.filter((item) => item !== tag);

    commitPatch({ tags: corridorTags.filter((item) => nextTags.includes(item)) });
  }

  function commitNotes(input: HTMLTextAreaElement) {
    commitPatch({ notes: readNotes(input) });
  }

  function commitPatch(patch: CorridorMetadataPatch) {
    const nextState = applyCorridorMetadataEdit(mapState, corridor.id, patch);

    if (nextState) {
      flushSync(() => onMapStateChange(nextState));
      closeOpenCorridorPopup();
    }
  }

  return (
    <section className="border border-sidebar-border bg-background p-3 text-sm">
      <h2 className="font-medium">Selected corridor</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-medium" htmlFor="corridor-name">
          Name
        </label>
        <input
          key={`${corridor.id}:name:${corridor.name}`}
          id="corridor-name"
          aria-label="Corridor name"
          className="w-full border border-input bg-background p-2 text-sm"
          defaultValue={corridor.name}
          onBlur={(event) => commitName(event.currentTarget)}
        />

        <label className="block text-xs font-medium" htmlFor="corridor-priority">
          Priority
        </label>
        <select
          id="corridor-priority"
          aria-label="Corridor priority"
          className="w-full border border-input bg-background p-2 text-sm"
          value={corridor.priority}
          onChange={(event) => commitPriority(event.target.value)}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">Tags</legend>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            {corridorTags.map((tag) => (
              <label key={tag} className="flex items-center gap-2">
                <input
                  aria-label={`Corridor tag ${tag}`}
                  className="size-3.5"
                  type="checkbox"
                  checked={corridor.tags.includes(tag)}
                  onChange={(event) => commitTag(tag, event.currentTarget.checked)}
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs font-medium" htmlFor="corridor-notes">
          Notes
        </label>
        <textarea
          key={`${corridor.id}:notes:${notesValue}`}
          id="corridor-notes"
          aria-label="Corridor notes"
          className="min-h-24 w-full border border-input bg-background p-2 text-sm"
          defaultValue={notesValue}
          onBlur={(event) => commitNotes(event.currentTarget)}
        />

        <p className="text-xs text-muted-foreground">
          Geometry: {corridor.geometry.coordinates.length} points
        </p>
      </div>
    </section>
  );
}

function closeOpenCorridorPopup() {
  document
    .querySelectorAll<HTMLElement>(".leaflet-popup-pane .leaflet-popup")
    .forEach((popup) => popup.remove());
}

function readRequiredText(input: HTMLInputElement, currentValue: string) {
  const value = input.value.trim();

  if (!value) {
    input.value = currentValue;
    return null;
  }

  input.value = value;
  return value;
}

function readNotes(input: HTMLTextAreaElement) {
  const notes = input.value
    .split("\n")
    .map((note) => note.trim())
    .filter(Boolean);

  input.value = notes.join("\n");
  return notes;
}
```

- [ ] **Step 4: Wire `CorridorEditor` into `Sidebar`**

In `components/apartment-map/sidebar.tsx`, add:

```ts
import { CorridorEditor } from "@/components/apartment-map/corridor-editor";
```

Add this selected corridor lookup next to `selectedTarget`:

```ts
  const selectedCorridor =
    selectedEntity?.kind === "corridor"
      ? mapState.corridors.find((corridor) => corridor.id === selectedEntity.id) ?? null
      : null;
```

Render the editor before `TargetEditor`:

```tsx
        {selectedCorridor ? (
          <CorridorEditor
            corridor={selectedCorridor}
            mapState={mapState}
            onMapStateChange={onMapStateChange}
          />
        ) : null}
```

- [ ] **Step 5: Run the e2e test to verify GREEN**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "edits selected corridor metadata"
```

Expected: pass.

- [ ] **Step 6: Write failing e2e test for custom corridor reset**

Add this test near the custom target reset test:

```ts
test("resetting a custom corridor removes the stale selected corridor", async ({ page }) => {
  await page.addInitScript(
    ({ key, state }) => {
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    {
      key: mapStateStorageKey,
      state: {
        ...seedMapState,
        corridors: [
          ...seedMapState.corridors,
          {
            id: "custom-corridor",
            name: "Custom corridor",
            geometry: {
              type: "LineString",
              coordinates: [
                [-122.437, 37.776],
                [-122.431, 37.781],
              ],
            },
            priority: "medium",
            tags: ["transit"],
            notes: ["Temporary corridor."],
          },
        ],
      },
    },
  );

  await page.goto("/");

  await page.getByText("Custom corridor").click();
  await expect(page.getByText("Active shape: Custom corridor")).toBeVisible();

  await page.getByRole("button", { name: "Reset selected shape" }).click();

  await expect(page.getByText("Active shape: None")).toBeVisible();
  await expect(page.getByLabel("Corridor name")).toHaveCount(0);
});
```

- [ ] **Step 7: Run the custom reset test to verify RED**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "resetting a custom corridor"
```

Expected: fail because resetting a custom corridor removes the corridor but leaves `selectedEntity` pointing at the deleted corridor.

- [ ] **Step 8: Clear stale selected custom corridor on reset**

In `components/apartment-map/apartment-map-app.tsx`, add this block in `resetSelectedShape()` after the custom-zone block and before the target block:

```ts
    if (
      selectedEntity.kind === "corridor" &&
      !seedMapState.corridors.some((corridor) => corridor.id === selectedEntity.id)
    ) {
      setSelectedEntity(null);
    }
```

- [ ] **Step 9: Run the custom reset test to verify GREEN**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "resetting a custom corridor"
```

Expected: pass.

- [ ] **Step 10: Run focused unit tests**

Run:

```bash
npm run test -- tests/unit/leaflet-map-state.test.ts
```

Expected: pass.

- [ ] **Step 11: Commit**

```bash
git add components/apartment-map/corridor-editor.tsx components/apartment-map/sidebar.tsx components/apartment-map/apartment-map-app.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Add corridor sidebar editor"
```

---

### Task 3: Reset and Clamping E2E Coverage

**Files:**
- Modify: `tests/e2e/apartment-map.spec.ts`
- Modify: `components/apartment-map/corridor-editor.tsx`

- [ ] **Step 1: Add corridor field limit constants to e2e tests**

Near the existing target limit constants in `tests/e2e/apartment-map.spec.ts`, add:

```ts
const maxCorridorNameLength = 160;
const maxCorridorTextLength = 2_000;
const maxCorridorNotes = 50;
```

- [ ] **Step 2: Write e2e test for corridor undo/reset**

Add this test near the target undo/reset test:

```ts
test("corridor field edits are undoable and resettable", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Polk Street").click();
  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await expect(page.getByText("Active shape: Polk Gulch spine")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Active shape: Polk Street")).toBeVisible();

  await page.getByLabel("Corridor name").fill("Polk Gulch spine");
  await page.getByLabel("Corridor name").blur();
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Gulch spine");
  await page.getByRole("button", { name: "Reset selected shape" }).click();
  await expect(page.getByLabel("Corridor name")).toHaveValue("Polk Street");
});
```

- [ ] **Step 3: Run corridor undo/reset test**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "corridor field edits are undoable"
```

Expected: pass.

- [ ] **Step 4: Write failing e2e test for corridor clamping**

Add this test near the target clamping test:

```ts
test("clamps selected corridor text fields to persisted schema limits", async ({ page }) => {
  const overlongName = `corridor-${"n".repeat(maxCorridorNameLength + 20)}`;
  const overlongNotes = [
    `note-${"x".repeat(maxCorridorTextLength + 20)}`,
    ...Array.from({ length: maxCorridorNotes + 5 }, (_, index) => `corridor-note-${index}`),
  ];
  const clampedName = overlongName.slice(0, maxCorridorNameLength);
  const clampedNotes = overlongNotes
    .slice(0, maxCorridorNotes)
    .map((note) => note.slice(0, maxCorridorTextLength));

  await page.goto("/");

  await page.getByText("Polk Street").click();
  await page.getByLabel("Corridor name").fill(overlongName);
  await page.getByLabel("Corridor name").blur();
  await page.getByLabel("Corridor notes").fill(overlongNotes.join("\n"));
  await page.getByLabel("Corridor notes").blur();

  await page.reload();

  await page.getByText(clampedName).click();
  await expect(page.getByLabel("Corridor name")).toHaveValue(clampedName);
  await expect(page.getByLabel("Corridor notes")).toHaveValue(clampedNotes.join("\n"));
});
```

- [ ] **Step 5: Run corridor clamping e2e test to verify RED**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "clamps selected corridor"
```

Expected: fail because the initial corridor editor persists overlong names and notes without clamping.

- [ ] **Step 6: Add corridor input clamping**

In `components/apartment-map/corridor-editor.tsx`, add constants after `corridorTags`:

```ts
const MAX_CORRIDOR_NAME_LENGTH = 160;
const MAX_CORRIDOR_TEXT_LENGTH = 2_000;
const MAX_CORRIDOR_NOTES = 50;
```

Change `commitName` to pass the max length:

```ts
    const value = readRequiredText(input, corridor.name, MAX_CORRIDOR_NAME_LENGTH);
```

Replace `readRequiredText`, `readNotes`, and add `clampText`:

```ts
function readRequiredText(input: HTMLInputElement, currentValue: string, maxLength: number) {
  const value = clampText(input.value.trim(), maxLength);

  if (!value) {
    input.value = currentValue;
    return null;
  }

  input.value = value;
  return value;
}

function readNotes(input: HTMLTextAreaElement) {
  const notes = input.value
    .split("\n")
    .map((note) => clampText(note.trim(), MAX_CORRIDOR_TEXT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_CORRIDOR_NOTES);

  input.value = notes.join("\n");
  return notes;
}

function clampText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
```

- [ ] **Step 7: Run corridor clamping e2e test to verify GREEN**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts --grep "clamps selected corridor"
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/apartment-map.spec.ts components/apartment-map/corridor-editor.tsx components/apartment-map/apartment-map-app.tsx
git commit -m "Cover corridor editor reset and clamping"
```

---

### Task 4: Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run unit tests**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: pass. If Google font fetch is blocked by sandbox network restrictions, rerun with network approval.

- [ ] **Step 5: Run e2e tests**

```bash
npm run test:e2e
```

Expected: all Playwright tests pass. If local server bind is blocked by sandboxing, rerun with the required localhost approval.

- [ ] **Step 6: Commit verification fixes**

If verification reveals implementation defects, write a failing focused test for the defect, fix it, rerun the focused test and full verification command that failed, then stage this feature's possible source and test files:

```bash
git add components/apartment-map/corridor-editor.tsx components/apartment-map/sidebar.tsx components/apartment-map/apartment-map-app.tsx components/apartment-map/leaflet-map-state.ts tests/e2e/apartment-map.spec.ts tests/unit/leaflet-map-state.test.ts
git commit -m "Fix corridor editor verification issue"
```
