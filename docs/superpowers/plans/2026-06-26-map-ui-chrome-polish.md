# Map UI Chrome Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish map UI chrome by separating controls from onboarding, restyling map controls and scrollbars, and removing duplicate API-key actions.

**Architecture:** Keep behavior unchanged and use native CSS plus one Leaflet/Geoman position change. `ApiKeyDialog` owns the duplicate button fix, `LeafletMap` owns toolbar positioning, and `app/globals.css` owns shared control and scrollbar styling.

**Tech Stack:** Next.js 16 App Router, React 19, Leaflet/Geoman, Tailwind CSS 4, Playwright.

## Global Constraints

- Do not add custom scrollbar libraries.
- Do not hide map edit controls.
- Do not change API-key storage behavior.
- Keep app chrome square-cornered and token-based.

---

### Task 1: Failing UI Regressions

**Files:**
- Modify: `tests/e2e/apartment-map.spec.ts`

**Interfaces:**
- Consumes: existing map shell, onboarding overlay, Leaflet/Geoman toolbar, and API-key card.
- Produces: E2E assertions for duplicate API-key actions, toolbar overlap, and scrollbar styling.

- [x] Add tests for the key form, toolbar placement, and scrollbar styling.
- [x] Run focused E2E and confirm failures against current UI.

### Task 2: API Key Action Cleanup

**Files:**
- Modify: `components/apartment-map/api-key-dialog.tsx`

**Interfaces:**
- Consumes: `isEditing`, `hasApiKey`, and existing `Button`.
- Produces: one visible API-key action set at a time.

- [x] Hide the bottom key action row while editing.
- [x] Run focused E2E and confirm the key-form test passes.

### Task 3: Map Control And Scrollbar Styling

**Files:**
- Modify: `components/apartment-map/leaflet-map.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Geoman `addControls` position and existing global CSS tokens.
- Produces: top-right edit toolbar, app-styled Leaflet controls, and app-wide scrollbar styling.

- [x] Move Geoman controls to `topright`.
- [x] Add Leaflet/Geoman control overrides in global CSS.
- [x] Add native scrollbar CSS in global CSS.
- [x] Run focused E2E and confirm overlap/scrollbar tests pass.

### Task 4: Verification

**Files:**
- No new implementation files.

- [x] Run `npm run test:e2e -- tests/e2e/apartment-map.spec.ts -g "map UI chrome|OpenAI key form"`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `npm run test`.
