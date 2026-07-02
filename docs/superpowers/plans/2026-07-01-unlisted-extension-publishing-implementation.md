# Unlisted Extension Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Facebook saver extension packageable for an unlisted Chrome Web Store release and expose a user-facing install/connect path in Apt Hunt.

**Architecture:** Keep the checked-in `extension/` folder usable for local unpacked development, then build a production copy in `dist/extensions/` with rewritten origins and a validated ZIP root. Keep app discovery UI compact by validating the public Chrome Web Store URL before rendering a link and moving local setup into a collapsed developer disclosure.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest, Chrome Manifest V3, `jszip` for ZIP creation/inspection, Node.js ESM scripts.

## Global Constraints

- The production package app origin is `https://hunt.apartments`.
- The production package `host_permissions` includes `https://hunt.apartments/*`.
- The production package `externally_connectable.matches` includes `https://hunt.apartments/*`.
- Production packages strip `http://localhost/*` from `host_permissions` and `externally_connectable.matches` by default.
- Local unpacked development remains possible against `http://localhost:3333`.
- Manifest extension icons must be PNG, not SVG or WebP, and must include `16`, `48`, and `128`.
- `NEXT_PUBLIC_CHROME_EXTENSION_URL` must be validated before rendering a clickable install link.
- Valid install URLs are HTTPS Chrome Web Store detail URLs on `chromewebstore.google.com`, plus the legacy `chrome.google.com/webstore/detail/` form.
- Missing or invalid install URLs must not render as clickable install links.
- Keep `EXTENSION_ALLOWED_IDS` as the server-side ownership check.
- `dist/` must be ignored by git.
- Do not add generated-by-agent language or AI co-author trailers to commits.
- New production code must be covered by a failing test first.

---

## File Structure

- `lib/extension/chrome-store-url.ts`: validates public Chrome Web Store install URLs.
- `components/apartment-map/extension-discovery-card.tsx`: renders signed-out, not-yet-public, install, connect, and developer setup states.
- `tests/unit/extension-discovery-card.test.ts`: covers the discovery UI states and invalid URL behavior.
- `extension/manifest.json`: local dev manifest with icon declarations and existing localhost development permissions.
- `extension/icons/icon-16.png`, `extension/icons/icon-48.png`, `extension/icons/icon-128.png`: checked-in PNG icons.
- `scripts/pack-extension.mjs`: copies the extension, rewrites production config/manifest, validates icons and ZIP layout, writes the Chrome Web Store ZIP.
- `tests/unit/extension-pack.test.ts`: tests the packaging helper and ZIP output.
- `package.json`, `package-lock.json`: add `extension:pack` and the ZIP helper dependency.
- `.gitignore`: ignore `dist/`.
- `docs/extension-publishing.md`: manual unlisted publishing instructions and reviewer test instructions.

---

### Task 1: Extension Discovery URL Validation And UX

**Files:**
- Create: `lib/extension/chrome-store-url.ts`
- Modify: `components/apartment-map/extension-discovery-card.tsx`
- Test: `tests/unit/extension-discovery-card.test.ts`

**Interfaces:**
- Produces: `getValidChromeExtensionUrl(rawUrl?: string | null): string | null`
- Consumes: `ExtensionDiscoveryCard({ ownershipMode, chromeExtensionUrl? })`, where `chromeExtensionUrl` is an optional test seam and defaults to `process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL`

- [ ] **Step 1: Write failing URL validation and UI tests**

Add focused tests that cover these behaviors:

```ts
expect(getValidChromeExtensionUrl("https://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
  "https://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
expect(getValidChromeExtensionUrl("https://chrome.google.com/webstore/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
  "https://chrome.google.com/webstore/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
expect(getValidChromeExtensionUrl("http://chromewebstore.google.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
expect(getValidChromeExtensionUrl("https://example.com/detail/apt-hunt/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
expect(getValidChromeExtensionUrl("https://chromewebstore.google.com/category/extensions")).toBeNull();
```

Update `tests/unit/extension-discovery-card.test.ts` so workspace mode with no URL contains `not ready for public install yet`, a collapsed `Developer setup` disclosure, and no anchor with text `Install Chrome Extension`. Add a valid URL case that renders an anchor with that label and the validated `href`. Add an invalid URL case that does not render that anchor.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/extension-discovery-card.test.ts
```

Expected: FAIL because `lib/extension/chrome-store-url.ts` and the new UI states do not exist yet.

- [ ] **Step 3: Implement the validator and discovery card states**

Implement `getValidChromeExtensionUrl` with `new URL`, require `https:`, require either `chromewebstore.google.com` with a path starting `/detail/` or `chrome.google.com` with a path starting `/webstore/detail/`, and return `url.toString()` with any trailing slash behavior preserved by `URL`.

Update the workspace card to:

- show `Install Chrome Extension` only when the validator returns a URL;
- show `Chrome Web Store install is not ready for public install yet.` when no valid URL is available;
- always show `After installing, open the extension popup and choose Connect Apt Hunt.`;
- rename the disclosure summary to `Developer setup`;
- leave unpacked setup and `EXTENSION_ALLOWED_IDS` inside the collapsed disclosure.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/extension-discovery-card.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/extension/chrome-store-url.ts components/apartment-map/extension-discovery-card.tsx tests/unit/extension-discovery-card.test.ts
git commit -m "Add extension install discovery states"
```

---

### Task 2: Extension Icons And Local Manifest Wiring

**Files:**
- Modify: `extension/manifest.json`
- Create: `extension/icons/icon-16.png`
- Create: `extension/icons/icon-48.png`
- Create: `extension/icons/icon-128.png`
- Test: `tests/unit/extension-pack.test.ts`

**Interfaces:**
- Produces: manifest icon entries `{ "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }`
- Produces: PNG files whose IHDR widths and heights exactly match `16`, `48`, and `128`

- [ ] **Step 1: Write failing manifest icon tests**

Create `tests/unit/extension-pack.test.ts` with a test that reads `extension/manifest.json`, asserts `manifest.icons` has string entries for `16`, `48`, and `128`, asserts every icon path ends in `.png`, asserts each referenced file exists, and parses the PNG IHDR bytes:

```ts
function readPngSize(filePath: string) {
  const data = readFileSync(filePath);
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}
```

Assert each icon has `{ width: Number(size), height: Number(size) }`.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- tests/unit/extension-pack.test.ts
```

Expected: FAIL because `manifest.icons` and the PNG files are missing.

- [ ] **Step 3: Add PNG icons and manifest entries**

Create `extension/icons/` and add `icon-16.png`, `icon-48.png`, and `icon-128.png`. Use the existing `app/icon.svg` as the visual source where practical, but the committed manifest files must be PNG. Add this block to `extension/manifest.json`:

```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

Do not remove local-development `http://localhost/*` permissions from the checked-in manifest.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm run test -- tests/unit/extension-pack.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/icons/icon-16.png extension/icons/icon-48.png extension/icons/icon-128.png tests/unit/extension-pack.test.ts
git commit -m "Add extension manifest icons"
```

---

### Task 3: Production Extension Pack Command

**Files:**
- Create: `scripts/pack-extension.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Test: `tests/unit/extension-pack.test.ts`

**Interfaces:**
- Produces: `packExtension({ rootDir, outputDir, productionOrigin, includeLocalhost? }): Promise<{ zipPath: string; manifest: object; entries: string[] }>`
- Produces CLI: `npm run extension:pack`
- Produces output path: `dist/extensions/apt-hunt-saver-<manifest.version>.zip`

- [ ] **Step 1: Add `jszip` dependency**

Run:

```bash
npm install --save-dev jszip
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Write failing package helper tests**

Extend `tests/unit/extension-pack.test.ts` with temporary-directory tests that import `packExtension` from `scripts/pack-extension.mjs` and assert:

- invalid manifest JSON rejects with an error containing `manifest`;
- generated production `config.js` contains `https://hunt.apartments`;
- generated ZIP entries include root `manifest.json`, `background.js`, `popup.html`, and icon files;
- no generated entry starts with `extension/`;
- production manifest `host_permissions` includes `https://hunt.apartments/*`;
- production manifest `host_permissions` does not include `http://localhost/*`;
- production manifest `externally_connectable.matches` equals `["https://hunt.apartments/*"]`;
- transient files `.DS_Store`, `notes.local.md`, `debug.js.map`, and existing `.zip` files are excluded.

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run test -- tests/unit/extension-pack.test.ts
```

Expected: FAIL because `scripts/pack-extension.mjs` does not exist.

- [ ] **Step 4: Implement package helper and CLI**

Implement `scripts/pack-extension.mjs` as an ESM module. Use `jszip` to create the archive. Copy files from `extension/` into an in-memory ZIP, excluding:

```js
const EXCLUDED_FILE_PATTERNS = [/\.DS_Store$/, /\.map$/, /\.zip$/, /(^|\/)notes\.local\.md$/];
```

Rewrite copied `config.js` so:

```js
export const appOrigin = "https://hunt.apartments";
export const extensionIdHeader = "x-sf-apt-extension-id";
```

Rewrite copied `manifest.json` for production:

```js
manifest.host_permissions = unique([
  ...(manifest.host_permissions ?? []).filter((permission) => permission !== "http://localhost/*"),
  "https://hunt.apartments/*",
]);
manifest.externally_connectable = { matches: ["https://hunt.apartments/*"] };
```

Validate after archive creation that entries include root `manifest.json`, `background.js`, `popup.html`, and every icon referenced by `manifest.icons`, and that no entry starts with `extension/`. Write to `dist/extensions/apt-hunt-saver-${manifest.version}.zip`.

Add the package script:

```json
"extension:pack": "node scripts/pack-extension.mjs"
```

Add `/dist/` to `.gitignore`.

- [ ] **Step 5: Run tests and package command to verify GREEN**

Run:

```bash
npm run test -- tests/unit/extension-pack.test.ts
npm run extension:pack
```

Expected: tests PASS and the command writes `dist/extensions/apt-hunt-saver-0.1.0.zip`.

- [ ] **Step 6: Commit**

```bash
git add scripts/pack-extension.mjs tests/unit/extension-pack.test.ts package.json package-lock.json .gitignore
git commit -m "Add production extension pack command"
```

---

### Task 4: Publishing Documentation

**Files:**
- Create: `docs/extension-publishing.md`
- Modify: `README.md`
- Test: `tests/unit/extension-pack.test.ts`

**Interfaces:**
- Produces: user-facing publishing instructions for unlisted Chrome Web Store release
- Produces: README pointer to publishing docs and pack command

- [ ] **Step 1: Write failing docs assertions**

Add a docs test to `tests/unit/extension-pack.test.ts` or a new focused docs test that reads `docs/extension-publishing.md` and asserts it contains these exact phrases:

```ts
expect(doc).toContain("npm run extension:pack");
expect(doc).toContain("Unlisted");
expect(doc).toContain("EXTENSION_ALLOWED_IDS");
expect(doc).toContain("NEXT_PUBLIC_CHROME_EXTENSION_URL");
expect(doc).toContain("Do not add the public install link before Chrome Web Store approval");
expect(doc).toContain("Chrome Dashboard Test instructions");
expect(doc).toContain("deterministic sign-in path");
expect(doc).toContain("deterministic Facebook test context");
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -- tests/unit/extension-pack.test.ts
```

Expected: FAIL because `docs/extension-publishing.md` does not exist.

- [ ] **Step 3: Add publishing doc and README pointer**

Create `docs/extension-publishing.md` with the 12-step publishing sequence from the spec. Include a reviewer instructions section with:

- Apt Hunt URL: `https://hunt.apartments`
- deterministic sign-in path requirement;
- install/connect steps;
- deterministic Facebook test context requirement;
- expected review popup/save behavior;
- note that the extension does not collect Facebook credentials and only reads visible post content from pages the signed-in browser user can already access.

Add a compact README pointer near the extension setup section:

```md
For unlisted Chrome Web Store packaging and release steps, see `docs/extension-publishing.md`.
```

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
npm run test -- tests/unit/extension-pack.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/extension-publishing.md README.md tests/unit/extension-pack.test.ts
git commit -m "Document unlisted extension publishing"
```

---

## Final Verification

After all tasks:

```bash
npm run lint
npm run typecheck
npm run test -- tests/unit/extension-discovery-card.test.ts tests/unit/extension-pack.test.ts
npm run extension:pack
```

Manually inspect the ZIP:

```bash
unzip -l dist/extensions/apt-hunt-saver-0.1.0.zip | head -40
```

Confirm `manifest.json` appears at the ZIP root and no `extension/` wrapper directory appears.

