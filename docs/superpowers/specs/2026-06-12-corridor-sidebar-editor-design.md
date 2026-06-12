# Corridor Sidebar Editor Design

## Goal

Make corridors editable from the sidebar so they behave like target planning anchors after selection. A selected corridor should expose the fields that already affect planning context: `name`, `priority`, `tags`, and `notes`.

## Current State

Corridors already store editable planning metadata in `TargetCorridor`: `name`, `priority`, `tags`, and `notes`. Users can edit corridor geometry on the map line, and the assistant can propose `updateCorridorPriority`, but there is no direct sidebar editor for corridor metadata.

Listing search currently receives corridor `id`, `name`, and `priority` only. Corridor `tags` and `notes` remain local map metadata and map-assistant context for this feature; adding them to listing-search context is out of scope.

## Design

Selecting a corridor renders a `Selected corridor` panel in the sidebar. The panel includes:

- `Name`: required text, clamped to the existing schema maximum.
- `Priority`: `high`, `medium`, or `low`.
- `Tags`: checkboxes for the existing tag enum: `fitness`, `rent`, `transit`, `safety`, and `short-term`.
- `Notes`: newline-separated notes, clamped to the existing notes limits.
- Read-only geometry summary: number of corridor points.

Geometry remains edited directly on the map. The sidebar must not expose coordinate inputs for this feature.

## Data Flow

Add a corridor metadata edit helper beside the existing map-state edit helpers. It accepts a corridor id and a patch for `name`, `priority`, `tags`, and `notes`, validates that at least one field changes, and returns the updated `MapState` or `null`.

`CorridorEditor` commits edits through the same `onMapStateChange` path used by target edits and geometry edits. This keeps local storage, history, undo, and reset behavior consistent.

Reset selected shape continues to restore the full seed corridor when one exists, including geometry and metadata. If a custom corridor is selected and reset, the corridor is removed and `selectedEntity` is cleared so the sidebar does not keep pointing at a deleted corridor.

## Proposal Scope

No assistant proposal contract changes are required for this feature. The existing `updateCorridorPriority` operation remains valid. Richer assistant corridor field proposals are out of scope and require a separate design.

## Testing

Unit tests should cover:

- Updating corridor metadata by id.
- Returning `null` for unknown corridor ids.
- Returning `null` when a patch does not change any fields.
- Preserving the existing field limits for corridor names, notes, and note count.

End-to-end tests should cover:

- Selecting a corridor shows the corridor editor.
- Editing name, priority, tags, and notes persists through reload.
- Corridor field edits are undoable.
- Reset selected shape restores seed corridor metadata.
- Resetting a custom corridor removes the stale selected corridor from the sidebar.
- Overlong corridor name and notes input is clamped before persistence.

## Out of Scope

- New corridor purpose, influence, or radius fields.
- Listing-search scoring changes.
- Assistant proposals for arbitrary corridor metadata updates.
- Sidebar coordinate editing for corridor geometry.
