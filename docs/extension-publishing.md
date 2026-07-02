# Extension Publishing

Use this checklist to publish the Apt Hunt Saver as an unlisted Chrome Web Store item. Unlisted extensions are installable by anyone with the link, but they do not appear in Chrome Web Store search. All submissions still go through Chrome Web Store review before users can install them.

## Publishing Sequence

1. Run `npm run extension:pack`.
2. Register or open the Chrome Developer Dashboard.
3. Upload the generated zip from `dist/extensions/`.
4. Fill the store listing, screenshots, privacy fields, and support/contact fields.
5. Fill the Chrome Dashboard Test instructions tab with the reviewer steps below.
6. Choose `Unlisted` visibility.
7. Submit for review.
8. Copy the Chrome Web Store extension id.
9. Add the id to Vercel production `EXTENSION_ALLOWED_IDS`.
10. Wait for Chrome Web Store approval and item publication.
11. Add the published item URL to `NEXT_PUBLIC_CHROME_EXTENSION_URL`.
12. Redeploy and smoke test install, connect, and save.

Do not add the public install link before Chrome Web Store approval. `EXTENSION_ALLOWED_IDS` may be configured before approval because it does not expose an install link to users.

## Reviewer Instructions

Write these details in the Chrome Dashboard Test instructions before submission:

- Apt Hunt URL: `https://hunt.apartments`.
- deterministic sign-in path: sign into Apt Hunt with any Google account the reviewer controls. First sign-in creates a blank workspace and does not require private product data.
- Install the extension, open the extension popup, click `Connect Apt Hunt`, sign in if prompted, and approve the extension connection page.
- deterministic Facebook test context: use the hosted reviewer fixture page at `https://hunt.apartments/extension/reviewer-fixture`. In the extension popup allowlist, manually add group URL `https://www.facebook.com/groups/apt-hunt-reviewer-fixture` with display name `Apt Hunt Reviewer Housing`.
- On `https://hunt.apartments/extension/reviewer-fixture`, click `Save to Apt Hunt` on the fixture listing.
- Expected result: the review popup appears, incomplete fields can be saved, and a successful save appears in Apt Hunt listing state.
- The extension does not collect Facebook credentials and only reads visible post content from pages the signed-in browser user can already access.

## Production Configuration

- Keep the Chrome Web Store extension id in production `EXTENSION_ALLOWED_IDS` so Apt Hunt can mint connection tokens only for the owned extension.
- Keep local unpacked extension ids in local `.env.local` only.
- Set `NEXT_PUBLIC_CHROME_EXTENSION_URL` only after the item is approved, published, and installable.
- Smoke test the final deployment by installing from the unlisted link, connecting to `https://hunt.apartments`, and saving from the documented test context.
