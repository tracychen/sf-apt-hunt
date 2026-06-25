# Task-Based Onboarding Design

## Goal

Add a first-run onboarding system that teaches the real SF Apartment Hunt planning loop by asking users to complete actual product actions:

1. set up AI access,
2. ask planning chat for useful map anchors,
3. apply a reviewed map suggestion,
4. edit a pin or corridor so it has useful planning meaning,
5. ask for listings using the map context,
6. save or dismiss a listing.

The onboarding experience should be compact, optional, and task-based. It should not block the map, force a modal wizard, or count a tour click as product understanding.

## Chosen Direction

Use a custom in-app onboarding checklist plus lightweight contextual highlights.

- Checklist UI: built in the sidebar as part of the app.
- Highlight engine: Driver.js.
- Signed-out persistence: browser storage through `lib/storage/`.
- Signed-in persistence: workspace-owned database state.
- Completion source: real app state/events, not "Next" clicks in a tour.

Driver.js is used only for "Show me" guidance on a specific checklist step. It should not own onboarding state. Official docs support npm installation and direct CSS import, and the library is lightweight, dependency-free, TypeScript-friendly, and MIT licensed:

- https://driverjs.com/docs/installation
- https://driverjs.com/

## Current State

The app now has two runtime paths:

- Signed-out users render `ApartmentMapApp`.
- Signed-in users render `PersistentApartmentMapApp`.

Signed-out state is browser-local. Signed-in map, listings, geocode, and planning chat state are workspace-backed in Postgres. The OpenAI key remains browser-local in both modes.

The sidebar already contains the main workflow surfaces:

- workspace/local status summary,
- map action buttons,
- map layers,
- selected target editor,
- selected corridor editor,
- OpenAI key dialog,
- planning chat.

Planning chat already renders reviewable map proposal cards and listing cards. Existing callbacks already know when a proposal is applied, a listing is saved or dismissed, a target/corridor edit changes map state, an OpenAI key is saved, and workspace state is reset/imported.

## UX

Add a compact `Getting started` panel near the top of the sidebar, after the app title/status block and before map actions/layers.

The panel shows:

- checklist title,
- completed count,
- current recommended next step,
- each step with completed/incomplete state,
- `Show me` action for steps with a UI target,
- `Dismiss` action,
- `Reset onboarding` action from the dismissed/completed recovery state or a small menu.

The panel should be visible by default for new users until dismissed or completed.

When dismissed, the full checklist is hidden and the sidebar title/status area shows a compact `Show getting started` control. When all steps are complete, the checklist collapses into a small completed state with `Review steps` and `Reset onboarding` controls. Onboarding must always be recoverable without clearing app data.

### Checklist Steps

V1 checklist steps:

```ts
type OnboardingStepId =
  | "set_ai_key"
  | "ask_for_anchors"
  | "apply_map_suggestion"
  | "edit_anchor_meaning"
  | "ask_for_listings"
  | "review_listing";
```

Step copy should be short and action-oriented:

- `set_ai_key`: Add your OpenAI key.
- `ask_for_anchors`: Ask chat to add pins or corridors.
- `apply_map_suggestion`: Review and apply a suggested map change.
- `edit_anchor_meaning`: Give a pin or corridor a planning purpose.
- `ask_for_listings`: Ask chat for listings near your map priorities.
- `review_listing`: Save or dismiss a listing lead.

The panel should avoid instructional paragraphs. It can use a one-line sublabel for the active step when needed.

### Completion Rules

Completion must come from product actions or persisted state.

`set_ai_key` completes when:

- `apiKey` is present in client state.

`ask_for_anchors` completes when:

- `PlanningChatPanel` emits a parent-visible milestone showing that a successful planning chat response includes a `mapProposal` or `targetEditProposal`, or
- the map has at least one custom target/corridor created by a planning chat action.

`apply_map_suggestion` completes when:

- a planning map action succeeds and returns an updated map snapshot or local map state, or
- a reviewed proposal is applied through the local apply-proposal path.

`edit_anchor_meaning` completes when:

- `TargetEditor` emits a semantic-edit signal after a user's target `purpose`, `influence`, `priority`, `radiusMinutes`, notes, or name edit produces a changed `MapState`, or
- `CorridorEditor` emits a semantic-edit signal after a user's corridor name, tags, notes, or priority edit produces a changed `MapState`.

Dragging a pin or corridor coordinate/geometry alone should not complete this step. The goal is semantic planning meaning, not manual placement.

`ask_for_listings` completes when:

- `PlanningChatPanel` emits a parent-visible milestone showing that a successful planning chat response includes a `listingResults` part.

`review_listing` completes when:

- a listing action is applied with kind `listingSave` or `listingDismiss`, or
- a listing lead status becomes `saved` or `dismissed`.

### Milestone Observation Contracts

The onboarding controller must not inspect private component state. Components that currently own milestone information must report explicit events upward.

`PlanningChatPanel` should accept an optional callback:

```ts
type PlanningChatOnboardingMilestone =
  | {
      kind: "anchorProposalReceived";
      messageId: string;
      proposalType: "mapProposal" | "targetEditProposal";
    }
  | { kind: "listingResultsReceived"; messageId: string; resultSetId: string };

type PlanningChatPanelProps = {
  onOnboardingMilestone?: (milestone: PlanningChatOnboardingMilestone) => void;
};
```

The panel emits these milestones only after the planning chat response has passed schema validation and the response has been accepted into the visible thread cache. Emitting a milestone does not apply any proposal or listing action; it only lets onboarding mark discovery steps complete.

`TargetEditor` and `CorridorEditor` should accept semantic-edit callbacks:

```ts
type AnchorSemanticEdit =
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

Editors emit `AnchorSemanticEdit` only after their existing edit helper returns a changed `MapState`. Generic `onMapStateChange(nextState)` alone is not a sufficient onboarding signal because geometry drags, imports, and other map writes share that pathway.

### Highlight Behavior

Each step with a UI target has a `Show me` button:

- `set_ai_key`: highlights the OpenAI key card.
- `ask_for_anchors`: highlights planning chat input.
- `apply_map_suggestion`: highlights a pending proposal card when one exists; otherwise highlights planning chat input with a prompt hint.
- `edit_anchor_meaning`: highlights selected target/corridor editor when an anchor is selected; otherwise highlights map target/corridor layer area and suggests selecting an anchor.
- `ask_for_listings`: highlights planning chat input.
- `review_listing`: highlights first pending listing card when one exists; otherwise highlights planning chat input.

Driver.js should be wrapped behind an app-owned helper, for example:

```ts
type OnboardingHighlightTarget =
  | "apiKey"
  | "planningChatInput"
  | "proposalCard"
  | "anchorEditor"
  | "listingCard";
```

Components expose stable `data-onboarding-target` attributes. The Driver.js wrapper maps a step to the best currently mounted target, handles missing targets gracefully, and never stores progress.

If the target is missing, the panel should show a short inline note rather than throwing:

- "Ask chat for a map suggestion first."
- "Select a pin or corridor to edit it."
- "Ask for listings first."

## Data Model

Add a small onboarding domain model in `lib/domain/types.ts` and `lib/domain/schemas.ts`.

```ts
type OnboardingStepId =
  | "set_ai_key"
  | "ask_for_anchors"
  | "apply_map_suggestion"
  | "edit_anchor_meaning"
  | "ask_for_listings"
  | "review_listing";

type OnboardingProgress = {
  version: 1;
  dismissed: boolean;
  expanded: boolean;
  completedSteps: Partial<Record<OnboardingStepId, string>>;
  lastHighlightedStepId: OnboardingStepId | null;
  updatedAt: string;
};
```

`completedSteps[stepId]` stores an ISO timestamp for the first completion of that step.

The model should use strict Zod validation at storage/API boundaries.

### Defaults

Default progress:

```ts
{
  version: 1,
  dismissed: false,
  expanded: true,
  completedSteps: {},
  lastHighlightedStepId: null,
  updatedAt: now
}
```

If stored progress fails validation, the app should log a safe warning and fall back to default progress.

## Signed-Out Persistence

Signed-out onboarding state lives in browser storage via a new wrapper in `lib/storage/`.

Storage key:

```txt
sf-apt-hunt:onboarding-progress:v1
```

Feature code must not call `window.localStorage` directly. It should use the wrapper.

Signed-out reset local map should not automatically reset onboarding. The user can reset onboarding from the panel. This avoids re-showing onboarding every time someone intentionally clears map data.

## Signed-In Persistence

Signed-in onboarding progress is workspace-owned durable state.

Add a nullable JSON column to `workspace`:

```ts
onboardingProgress: OnboardingProgress | null;
```

`GET /api/workspace` and `GET /api/workspace/client-state` return current onboarding progress as part of the workspace initial state. If the DB value is null, the server returns the default object.

Add a workspace route:

```txt
PUT /api/workspace/onboarding
```

Request:

```ts
type PutWorkspaceOnboardingRequest = {
  operation:
    | {
        type: "completeSteps";
        stepIds: OnboardingStepId[];
      }
    | {
        type: "setPanelState";
        dismissed?: boolean;
        expanded?: boolean;
        lastHighlightedStepId?: OnboardingStepId | null;
      }
    | {
        type: "reset";
      };
};
```

Response:

```ts
type PutWorkspaceOnboardingResponse =
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

This route requires the signed-in session and same-origin mutation protections used by other workspace routes. It is user-owned via the current default workspace; clients do not send `workspaceId`.

Onboarding writes do not need map or listing revision compare-and-set semantics because they are non-critical UI progress, but the server must merge operations against the current DB value rather than replacing the full object from the client.

The merge must be atomic. The implementation must use one of these approaches:

- a database transaction with a row-level lock on the current `workspace` row before reading and writing `onboardingProgress`,
- a SQL-level JSON update that cannot overwrite unrelated concurrently completed steps,
- or an optimistic compare-and-retry loop that re-reads current progress and retries the merge when the row changed.

It is not acceptable to read progress, merge in application memory, and write the whole JSON value without locking or retrying; two concurrent `completeSteps` requests must not lose either step.

Merge rules:

- `completeSteps` unions `stepIds` into `completedSteps`.
- Existing completed step timestamps are preserved.
- New completed step timestamps use the server's current time.
- `setPanelState` is last-write-wins for `dismissed`, `expanded`, and `lastHighlightedStepId`.
- `reset` replaces progress with a fresh default object and is the only operation allowed to clear `completedSteps`.
- Every successful operation updates `updatedAt` server-side.

The route should match existing workspace route behavior:

- `403` for forbidden cross-origin mutations,
- `401` for missing/invalid signed-in session,
- `413` when the request body exceeds the route cap,
- `400` for invalid JSON or schema validation failure,
- `500` for unexpected persistence failures, with server-side logging.

Workspace reset should preserve onboarding progress by default. Workspace delete deletes onboarding progress because it deletes the workspace row.

## Client Architecture

Add an onboarding controller layer used by both app modes.

Suggested units:

```txt
lib/onboarding/steps.ts
lib/onboarding/progress.ts
lib/storage/onboarding-storage.ts
components/apartment-map/onboarding-panel.tsx
components/apartment-map/use-onboarding-highlights.ts
app/api/workspace/onboarding/route.ts
```

`steps.ts` owns the step list, display labels, dependencies, and highlight target mapping.

`progress.ts` owns pure functions:

- `createDefaultOnboardingProgress(now)`
- `completeOnboardingStep(progress, stepId, now)`
- `applyOnboardingOperation(progress, operation, now)`
- `dismissOnboarding(progress, now)`
- `resetOnboardingProgress(now)`
- `deriveCompletedStepsFromState(input)`

`OnboardingPanel` is presentational. It receives progress, step definitions, completion status, and callbacks.

The app containers own persistence:

- `ApartmentMapApp` loads/saves local onboarding progress.
- `PersistentApartmentMapApp` receives initial progress and writes operation updates through `/api/workspace/onboarding`.

`Sidebar` receives onboarding props and renders `OnboardingPanel`. It also forwards onboarding milestone callbacks to `TargetEditor`, `CorridorEditor`, and `PlanningChatPanel`.

## State-Derived Completion

The app should mark steps complete at two points:

1. when a known action succeeds,
2. when current state already implies completion after load.

Examples:

- If the OpenAI key loads from browser storage, complete `set_ai_key`.
- If the workspace map already contains custom target/corridor anchors from a previous session, this may complete `ask_for_anchors` only if there is evidence it came from planning chat. If that evidence is not available, do not infer it.
- If planning thread cache contains a `listingResults` part, complete `ask_for_listings`.
- If listing leads include saved/dismissed entries, complete `review_listing`.

The conservative rule is preferred: only infer completion when the signal is strongly tied to the step.

## Error Handling

Signed-out storage failures:

- log with module context,
- keep in-memory progress for the session,
- do not block core app workflows.

Signed-in route failures:

- keep optimistic in-memory progress,
- show a small non-blocking panel notice if persistence fails,
- retry on the next progress-changing event.

Driver.js failures or missing targets:

- destroy any existing driver instance,
- show a short inline note,
- do not change progress.

## Accessibility

The checklist must be keyboard accessible:

- steps are buttons or proper controls,
- completed state is text, not color-only,
- `Show me`, `Dismiss`, and `Reset onboarding` are reachable by keyboard,
- Driver.js overlays must be dismissible with Escape,
- focus should return to the triggering button after a highlight closes when possible.

The onboarding panel must not trap focus or prevent normal map/chat usage.

## Non-Goals

- External onboarding SaaS such as Appcues, Userflow, Pendo, or Chameleon.
- Product analytics vendor integration.
- AI-generated onboarding copy.
- Blocking wizard or forced tour.
- Multiple onboarding tracks/personas.
- Server-side OpenAI key storage.
- Resetting onboarding automatically on map reset.

## Analytics-Ready Events

Do not add an analytics provider in V1. Use stable internal event names in code comments/types only if helpful:

```txt
onboarding_step_completed
onboarding_step_highlighted
onboarding_dismissed
onboarding_reset
```

If PostHog or another product analytics tool is added later, these events can be emitted without changing the domain model.

## Testing

Unit tests:

- default progress creation,
- strict schema validation,
- completing a step is idempotent and preserves first timestamp,
- operation merge preserves existing completed-step timestamps across stale-client updates,
- reset operation is the only operation that clears completed steps,
- dismiss/reset behavior,
- derived completion from API key, planning chat parts, action records, and listing lead status,
- semantic anchor edit detection excludes geometry-only changes.

Storage tests:

- signed-out wrapper loads valid progress,
- invalid JSON or schema mismatch falls back safely,
- save/reset write the expected namespaced key.

Route tests:

- signed-out `PUT /api/workspace/onboarding` returns `401`,
- cross-origin `PUT /api/workspace/onboarding` returns `403`,
- over-large request body returns `413`,
- invalid body returns `400`,
- unexpected persistence failure returns `500` with a safe response,
- signed-in request updates only the current user's workspace,
- `completeSteps` merges with existing DB progress instead of replacing it,
- concurrent `completeSteps` requests for different steps both persist,
- stale clients cannot remove an already-completed step,
- `setPanelState` updates dismissed/expanded/highlight state without altering completed steps,
- `reset` clears completed steps and returns default progress,
- response returns validated progress,
- workspace client-state includes onboarding progress default when DB value is null.

E2E tests:

- first-run sidebar shows `Getting started`,
- saving an OpenAI key completes the AI key step,
- `Show me` for planning chat opens and closes a highlight without completing the step,
- receiving a planning chat map proposal completes `ask_for_anchors` before the proposal is applied,
- applying a map proposal completes `apply_map_suggestion`,
- editing a target purpose or corridor notes completes `edit_anchor_meaning`,
- dragging a target without changing semantic fields does not complete `edit_anchor_meaning`,
- listing results complete `ask_for_listings`,
- saving or dismissing a listing completes `review_listing`,
- dismiss survives refresh in both signed-out and signed-in modes,
- reset onboarding reopens the checklist.

## Rollout

1. Add domain types/schemas and pure progress helpers.
2. Add signed-out storage wrapper.
3. Add DB column/migration and signed-in route.
4. Include onboarding progress in workspace initial/client state.
5. Add panel UI in the sidebar.
6. Add Driver.js wrapper and stable `data-onboarding-target` attributes.
7. Wire completion events from existing callbacks.
8. Add tests.

## Open Questions

None for V1. The chosen behavior is:

- support both signed-out and signed-in users,
- keep signed-out progress local,
- persist signed-in progress in workspace DB,
- preserve onboarding across workspace/map reset,
- use Driver.js for optional contextual highlights only.
