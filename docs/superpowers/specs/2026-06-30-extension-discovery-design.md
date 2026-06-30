# Extension Discovery Design

## Goal

Expose the Facebook saver extension from inside Apt Hunt so users know it exists before Chrome Web Store distribution is ready.

## Placement

Add a compact sidebar card below the map/layer controls and before API key/chat controls. This keeps discovery near workspace/import controls, not inside planning chat.

## States

- Signed-in workspace: show the extension as available for workspace sync, with a compact setup disclosure.
- Local-first workspace: show an educational state that explains the extension needs sign-in so saved Facebook posts sync into a durable workspace.

## Copy

Signed-in card:

- Heading: `Facebook saver extension`
- Body: `Save reviewed Facebook housing posts into this workspace.`
- Disclosure/action: `Setup extension`
- Setup steps: load unpacked from `extension/`, copy extension id into `EXTENSION_ALLOWED_IDS`, restart the app, then connect and allowlist groups from the extension popup.

Signed-out card:

- Heading: `Facebook saver extension`
- Body: `Sign in to sync Facebook saves across devices.`
- Action: `Sign in to use extension`

## Non-Goals

- No Chrome Web Store link until a listing exists.
- No automatic extension detection in this slice.
- No onboarding-step changes.
