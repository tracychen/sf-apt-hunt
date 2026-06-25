# Onboarding Map Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Getting started onboarding UI as a map overlay instead of sidebar content.

**Architecture:** Reuse the existing `OnboardingPanel` and move its host from `Sidebar` to `ApartmentMapViewport`. The local and persistent app shells pass onboarding props into the map viewport, while `Sidebar` keeps only planning and map-control responsibilities.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, Playwright.

## Global Constraints

- Keep onboarding state, completion, reset, dismiss, and highlight behavior unchanged.
- Do not duplicate onboarding rendering logic.
- The overlay must not block map interaction outside the panel itself.
- Signed-out and signed-in app shells must render the same overlay behavior.

---

### Task 1: Layout Regression

**Files:**
- Modify: `tests/e2e/apartment-map.spec.ts`

**Interfaces:**
- Consumes: existing map shell and onboarding text.
- Produces: an E2E regression for `[data-testid="map-onboarding-overlay"]`.

- [x] Add a Playwright test that loads `/`, asserts `aside` does not contain the `Getting started` heading, asserts `[data-testid="map-onboarding-overlay"]` contains the heading, and compares bounding boxes so the overlay is positioned before the sidebar on desktop.
- [x] Run `npm run test:e2e -- tests/e2e/apartment-map.spec.ts -g "getting started overlay"` and confirm it fails because the overlay does not exist yet.

### Task 2: Move Onboarding Host

**Files:**
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `components/apartment-map/persistent-apartment-map-app.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/onboarding-panel.tsx`

**Interfaces:**
- Consumes: `OnboardingController`, `OnboardingStepId`, and existing `OnboardingPanel` props.
- Produces: `ApartmentMapViewport` props for onboarding and map overlay rendering.

- [x] Add onboarding props to `ApartmentMapViewport`.
- [x] Render `OnboardingPanel` in an absolute map overlay with `data-testid="map-onboarding-overlay"`.
- [x] Pass onboarding props from both local and persistent app shells into `ApartmentMapViewport`.
- [x] Remove onboarding props and `OnboardingPanel` rendering from `Sidebar`.
- [x] Restyle `OnboardingPanel` roots from sidebar borders to overlay/chip chrome.

### Task 3: Verification

**Files:**
- No new implementation files.

- [x] Run `npm run test:e2e -- tests/e2e/apartment-map.spec.ts -g "getting started overlay"`.
- [x] Run `npm run test:e2e -- tests/e2e/apartment-map.spec.ts -g "onboarding"`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run test -- tests/unit/use-onboarding-controller.test.ts`.
