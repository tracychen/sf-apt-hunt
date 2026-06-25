# Planning Areas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split passive neighborhood outlines from explicit user planning areas that can be created, edited, and used for listing planning.

**Architecture:** Keep existing `MapZone` records as reference neighborhood outlines. Add a new `PlanningArea` polygon collection to `MapState`, render it as a separate layer, and score listings against user-created areas. Existing saved maps without `areas` remain valid by treating missing `areas` as an empty array at read/use sites.

**Tech Stack:** Next.js 16 App Router, React 19, Leaflet/React-Leaflet, TypeScript, Zod, Vitest, Playwright.

## Global Constraints

- Domain coordinates are `[lng, lat]`; Leaflet receives `[lat, lng]` only at the map boundary.
- AI proposes; server applies after Zod validation.
- User-created planning areas must be explicit; default neighborhood outlines must remain passive reference data.
- Keep local and workspace map state compatible with older JSON that does not include `areas`.
- Preserve existing pins/corridors/listing behavior unless a test requires a focused adjustment.

---

### Task 1: Domain And Validation

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Modify: `lib/map/seed-data.ts`
- Test: `tests/unit/domain-schemas.test.ts`
- Test: `tests/unit/seed-data.test.ts`

**Interfaces:**
- Produces: `PlanningArea`, `MapState.areas?: PlanningArea[]`, `planningAreaSchema`.
- Consumes: existing `Priority`, `TargetInfluence`, `PolygonGeometry`, `notesSchema`.

- [x] Add `PlanningArea` with `id`, `name`, `purpose`, `geometry`, `priority`, `influence`, and `notes`.
- [x] Add `planningAreaSchema` and include `areas` in `mapStateSchema` with a default empty array.
- [x] Add `areas: []` to `seedMapState` and `samplePlanningMapState`.
- [x] Add tests that validate planning areas and assert default maps start with no areas.

### Task 2: Helpers And Listing Scoring

**Files:**
- Create: `lib/map/planning-areas.ts`
- Modify: `components/apartment-map/leaflet-map-state.ts`
- Modify: `lib/map/listing-planning-score.ts`
- Test: `tests/unit/listing-planning-score.test.ts`
- Test: `tests/unit/leaflet-map-state.test.ts`

**Interfaces:**
- Produces: `getPlanningAreas(mapState)`, `createAreaFromZone(zone)`, `applyPlanningAreaFieldPatch`, `applyPlanningAreaGeometryEdit`, `isPointInPolygon`.
- Consumes: `PlanningArea`, `MapZone`, `MapState`.

- [x] Add helpers to read areas with a missing-array fallback.
- [x] Add a helper that creates a planning area from a neighborhood outline.
- [x] Add geometry and metadata patch helpers for planning areas.
- [x] Replace selected-zone listing scoring with area scoring. Geocoded listings use point-in-polygon; listings without coordinates can fall back to area name/purpose matching.

### Task 3: Map Rendering And Sidebar Editing

**Files:**
- Modify: `components/apartment-map/leaflet-map.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Create: `components/apartment-map/area-editor.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `components/apartment-map/persistent-apartment-map-app.tsx`
- Test: `tests/e2e/apartment-map.spec.ts`

**Interfaces:**
- Produces: selected entity kind `"area"`, visible layer key `"areas"`, `AreaEditor`.
- Consumes: helper functions from `lib/map/planning-areas.ts` and `leaflet-map-state.ts`.

- [x] Rename visible “Zones” layer copy to “Neighborhoods”.
- [x] Add a separate “Areas” layer.
- [x] Add a “Use as planning area” action to neighborhood popups.
- [x] Render planning areas as editable polygons with influence-specific styling.
- [x] Add a sidebar editor for area name, purpose, influence, priority, and notes.
- [x] Update reset/undo/import behavior to account for areas.

### Task 4: Assistant And Proposal Integration

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Modify: `lib/map/proposals.ts`
- Modify: `lib/server/planning/context.ts`
- Modify: `components/apartment-map/planning-chat-panel.tsx`
- Test: `tests/unit/map-proposals.test.ts`
- Test: `tests/routes/map-assistant-route.test.ts`

**Interfaces:**
- Produces: proposal operations `addArea` and `updateAreaPlanningFields`.
- Consumes: `PlanningArea`.

- [x] Include areas in visible planning chat context.
- [x] Include areas in listing selected context.
- [x] Add proposal operations for adding and editing planning areas.
- [x] Ensure duplicate ID checks include areas.

### Task 5: Verification

**Files:**
- No new files.

- [x] Run `npm run typecheck`.
- [x] Run focused unit tests for schemas, map helpers, proposals, and listing scoring.
- [x] Run focused E2E tests for area creation/editing.
- [x] Run `npm run lint`, `npm run test`, and `npm run build`.
