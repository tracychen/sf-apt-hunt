# Onboarding Map Overlay Design

## Goal

Move the task-based Getting started UI out of the sidebar and onto the map so the sidebar stays focused on planning chat, selected anchors, map layers, and import/reset controls.

## Design

The existing `OnboardingPanel` remains the only component that renders onboarding content and actions. `ApartmentMapViewport` becomes the presentation host for that panel by rendering it as an absolutely positioned overlay above the Leaflet map. The local and persistent app shells pass the same onboarding controller, highlight message, and show-step callback into `ApartmentMapViewport`.

The overlay sits at the top-left of the map on desktop and spans the mobile map width with safe insets. Its wrapper uses `pointer-events-none`, while the panel itself uses `pointer-events-auto`, so map interaction continues outside the panel. The panel uses app chrome: sidebar/background tokens, a border, square corners, backdrop blur, and a constrained max height with internal scrolling for the full six-step list.

Dismissed and completed-collapsed states become compact map chips using the same `OnboardingPanel` state. They remain recoverable with the existing Show getting started or Review steps actions, but no longer consume sidebar rows.

## Data Flow

- `useOnboardingController` remains unchanged.
- `useOnboardingHighlights` remains unchanged.
- `Sidebar` stops receiving onboarding props and no longer renders `OnboardingPanel`.
- `ApartmentMapViewport` receives onboarding props and renders `OnboardingPanel` inside a map overlay.
- The existing `onShowOnboardingStep` callback still records `lastHighlightedStepId` before invoking Driver.js.

## Testing

Add an E2E regression that loads the map shell, verifies the sidebar does not contain the Getting started heading, verifies a map overlay contains it, and verifies the overlay is positioned over the map rather than in the sidebar.
