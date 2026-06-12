# Corridor Sidebar Editor Design

## Goal

Make corridors editable from the sidebar so they behave like target planning anchors after selection. A selected corridor should expose the fields that already affect planning context: `name`, `priority`, `tags`, and `notes`.

## Current State

Corridors already store editable planning metadata in `TargetCorridor`: `name`, `priority`, `tags`, and `notes`. Users can edit corridor geometry on the map line, and the assistant can propose `updateCorridorPriority`, but there is no direct sidebar editor for corridor metadata. Listing search already receives selected corridor context, so clearer corridor metadata can matter once search/scoring uses it more deeply.

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

Reset selected shape continues to restore the full seed corridor when one exists, including geometry and metadata. If a custom corridor is selected and reset, it is removed using the existing reset behavior.

## Proposal Scope

No assistant proposal contract changes are required for this feature. The existing `updateCorridorPriority` operation remains valid. Richer assistant corridor field proposals are out of scope and require a separate design.

## Testing

Unit tests should cover:

- Updating corridor metadata by id.
- Returning `null` for unknown corridor ids.
- Returning `null` when a patch does not change any fields.

End-to-end tests should cover:

- Selecting a corridor shows the corridor editor.
- Editing name, priority, tags, and notes persists through reload.
- Corridor field edits are undoable.
- Reset selected shape restores seed corridor metadata.

## Out of Scope

- New corridor purpose, influence, or radius fields.
- Listing-search scoring changes.
- Assistant proposals for arbitrary corridor metadata updates.
- Sidebar coordinate editing for corridor geometry.
