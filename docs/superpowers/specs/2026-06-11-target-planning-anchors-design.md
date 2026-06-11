# Target Planning Anchors Design

## Goal

Make target points useful as planning anchors on the apartment-search map. A target point should explain why a specific place matters, support manual editing after drag operations, and provide structured data that can later improve zone and listing scoring.

## Current Behavior

Target points are map pins with a name, coordinates, priority, and notes. Users can drag them, and dragging updates only the coordinates. The visible name remains unchanged, so a moved `Valencia & 20th` pin can still look like it represents the original intersection. Target points are included in map-assistant requests through full `mapState`, but listing search only receives selected zones and corridors.

## Target Point Model

Extend `TargetPoint` with planning fields:

```ts
type TargetPoint = {
  id: string;
  name: string;
  purpose: string;
  coordinates: [number, number];
  priority: "high" | "medium" | "low";
  influence: "positive" | "negative" | "neutral";
  radiusMinutes: 5 | 10 | 15 | 20;
  notes: string[];
};
```

Field meanings:

- `name`: editable location label, such as `Valencia & 20th` or `Custom location`.
- `purpose`: user-entered reason the point matters, such as `favorite block`, `late-night noise`, or `easy grocery run`.
- `influence`: whether proximity to the point should help, hurt, or not affect future scoring.
- `priority`: scoring and visual weight.
- `radiusMinutes`: the planning radius around the point.
- `notes`: supporting free-form context.

Migration for stored or seed data:

- `purpose` defaults to the target name.
- `influence` defaults to `positive`.
- `radiusMinutes` defaults to `10`.

Seed targets can override these defaults with more useful purpose text.

Display code should avoid duplicate labels. If `purpose` and `name` are the same after migration, the label renders as `name` rather than `purpose · name`.

## Map Behavior

Target labels should prefer planning meaning over raw geography:

- Normal label: `purpose · name`
- Moved seed target with no edited label: `purpose · Custom location`

Dragging a target point updates `coordinates` and preserves all planning fields, except for one label-safety rule: if a seed target is dragged and the user has not manually edited its location label, the app changes `name` to `Custom location` so the label does not imply the original intersection.

The first implementation can detect an untouched seed label by comparing the current target name to the matching seed target name. If the user has already typed a different label, dragging should not overwrite it.

Target pins should visually communicate `influence`:

- `positive`: beneficial planning anchor.
- `negative`: caution or avoid anchor.
- `neutral`: reference marker.

The map should show a radius ring for each target based on `radiusMinutes`. The first implementation can use approximate walking-distance circles rather than route-aware isochrones, using a fixed walking estimate such as 80 meters per minute.

## Editing Experience

Selecting a target opens editable fields in the side panel:

- Purpose: free text.
- Location label: free text.
- Influence: positive, negative, neutral.
- Priority: high, medium, low.
- Radius: 5, 10, 15, or 20 minutes.
- Notes: editable text area or note list.
- Coordinates: read-only display, edited by dragging the pin.

Sidebar edits use the same client map-state update path as drag edits and proposal applies. Each committed field edit should update local storage and push a history entry so undo/reset behavior remains consistent across geometry edits, target field edits, and accepted assistant proposals.

The mental model is:

- Dragging edits where the planning anchor is.
- The sidebar edits what it means.

Reset behavior follows the current selected-entity pattern:

- Seed targets reset to their seed values, including original coordinates and planning fields.
- Custom targets that do not exist in seed data are removed by reset.

## Assistant And Listing Search Flow

Map-assistant requests already send full `mapState`, so target planning fields naturally become available for map-edit and prioritization proposals. The assistant should be allowed to propose target field updates and new target points, subject to the existing review modal.

The proposal contract should add an explicit target-field operation:

```ts
type UpdateTargetPlanningFieldsOperation = {
  type: "updateTargetPlanningFields";
  targetId: string;
  name?: string;
  purpose?: string;
  influence?: "positive" | "negative" | "neutral";
  priority?: "high" | "medium" | "low";
  radiusMinutes?: 5 | 10 | 15 | 20;
  notes?: string[];
  reason: string;
};
```

At least one editable target field must be present. Applying this operation validates `targetId`, validates every provided field, and updates only provided fields. `notes` replaces the reviewed notes array; appending a single note can continue using the existing `addNote` operation. The review modal previews before and after values for every changed target field.

The implementation must update all proposal contracts together:

- `MapPatchProposal` TypeScript types.
- Zod proposal schemas.
- Proposal apply logic.
- Proposal review UI.
- The strict OpenAI structured-output JSON schema in `app/api/ai/map-assistant/route.ts`, including both `targetPointJsonSchema` for `addTarget` and `mapPatchProposalJsonSchema` for `updateTargetPlanningFields`.

If strict OpenAI structured outputs require every object property to be listed in `required`, the JSON schema can represent optional target fields as nullable values and normalize `null` fields away before Zod validation, matching the existing `updateZoneScores` pattern.

Listing search should remain unchanged in the first target-planning pass. A later scoring pass can include target context in listing search and use `influence`, `priority`, and `radiusMinutes` to explain ranking adjustments.

## Future Scoring Direction

Target points provide scoring inputs, but scoring should not be the first implementation step. Future scoring can use these rules:

- Positive high-priority targets improve fit when a zone or listing is within the target radius.
- Negative high-priority targets reduce fit when a zone or listing is within the target radius.
- Neutral targets are shown on the map but do not affect score.
- Priority controls weight.
- Radius controls the distance threshold.

This keeps scoring tied to explicit planning intent instead of hidden model inference from arbitrary purpose text.

## Validation And Limits

Schema validation should require:

- Non-empty `purpose` and `name` with existing string length limits.
- `influence` in `positive`, `negative`, or `neutral`.
- `radiusMinutes` in `5`, `10`, `15`, or `20`.
- Coordinates inside San Francisco bounds.
- Existing target count limits.

Stored map-state loading should accept older target records by applying the migration defaults above before schema validation rejects missing fields.

## Testing

Unit tests should cover:

- Target schema validation for new fields.
- Stored-state migration from old target objects.
- Dragging a target updates coordinates and preserves planning fields.
- Dragging an untouched seed target changes the display/location label to `Custom location`.
- Reset restores seed target planning fields and removes non-seed custom targets.

Route tests should cover assistant proposals that update target planning fields.

Route tests should also cover that assistant structured-output schemas accept `addTarget` records with the new target fields and reject invalid target planning fields.

E2E tests should cover selecting a target, editing purpose/influence/priority/radius/notes, dragging it, and seeing the updated label and radius ring on the map.
