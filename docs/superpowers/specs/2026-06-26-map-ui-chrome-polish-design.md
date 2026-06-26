# Map UI Chrome Polish Design

## Goal

Make the map overlay chrome feel like the rest of the app by removing onboarding/tool overlap, replacing default Leaflet/Geoman button styling, using quieter scrollbars, and removing duplicate API-key actions while the key form is open.

## Design

The Geoman edit toolbar moves out of the onboarding overlay lane. It stays visible and usable, but sits at the top-right of the map so the Getting started overlay can own the top-left. Leaflet and Geoman controls get app-level CSS overrides: square corners, app border/background tokens, compact icon buttons, muted hover/focus states, and no default raised white toolbar shadow.

Scrollable app surfaces get a shared scrollbar style through global CSS. The treatment uses a narrow muted thumb, transparent/muted track, square geometry, and browser-native scrollbar APIs only. This applies to onboarding, sidebar, planning chat results, and other scrollable panels without adding a scrollbar library.

The OpenAI key card stops rendering its bottom action row while the key form is open. Users see one clear action set at a time: `Save key` and `Cancel` while editing, then `Clear key` and `Add/Replace OpenAI key` after editing closes.

## Testing

Add E2E coverage that:

- Opens the API-key form and verifies the extra `Add OpenAI key` button is gone while `Save key` and `Cancel` are visible.
- Verifies the map editing toolbar does not overlap the Getting started overlay.
- Verifies app scrollbar styling is active on the onboarding overlay through computed browser styles.
