<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo runs **Next.js 16** with the App Router, React 19, and Server Components. APIs and conventions may differ from your training data. Before editing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecations.
<!-- END:nextjs-agent-rules -->

## Rules

- Read before editing. For behavior questions, trace browser -> API route -> server helper -> external API.
- Keep diffs focused. No unrelated refactors, renames, or abstractions.
- Validate request bodies, external responses, and AI output with Zod or strict JSON schemas.
- Run relevant verification before saying work is done.

## Project Map

SF Apartment Hunt is an apartment-search map with two persistence modes. Signed-out users stay local-first with browser storage. Signed-in users use Better Auth, Google OAuth, Drizzle, and Postgres-backed workspaces for durable map, listing, geocode, and planning-chat state. The user's OpenAI key remains browser-local in both modes.

- `app/page.tsx` renders `ApartmentMapApp` for signed-out users and `PersistentApartmentMapApp` for signed-in users.
- Leaflet is client-only via `dynamic(..., { ssr: false })`.
- `app/api/ai/listing-search` uses OpenAI Responses + hosted `web_search`, parses strict JSON, and mints geocode nonces.
- `app/api/ai/map-assistant` returns reviewable `MapPatchProposal`s. It never applies edits.
- `app/api/ai/planning-chat` stores signed-in planning state through the workspace planning store and keeps unsigned/dev compatibility.
- `app/api/map/apply-proposal` re-validates and applies reviewed proposals.
- `app/api/workspace/*` owns signed-in workspace map, listing, geocode, reset/delete, and client-state routes.
- `app/api/geocode/listing` verifies nonces, rate limits, calls Google Geocoding, and rejects out-of-SF results.
- `lib/domain/` owns types and Zod schemas. `lib/server/` is server-only. `lib/storage/` owns browser storage.
- `lib/db/` owns Drizzle schema/client/migrations. `lib/server/workspaces.ts`, `workspace-state.ts`, `listing-leads-db.ts`, and `planning/store-db.ts` own signed-in DB persistence.
- `docs/superpowers/{specs,plans}/` explains feature intent and implementation history.

## Data Contracts

- When a domain field changes, update the TypeScript type, Zod schema, and any raw OpenAI JSON schema.
- OpenAI JSON schemas may intentionally be narrower than Zod schemas; preserve those narrowings.
- Domain coordinates are `[lng, lat]`. Leaflet uses `[lat, lng]`; convert only at the Leaflet boundary.
- Keep `lib/geocode/canonicalize.ts` aligned with both the geocode cache key and nonce hash.

## Security

- OpenAI keys are BYO. Forward as bearer tokens with `store: false`; never store, log, or echo them server-side.
- Wrap client-visible error details in `redactSecrets()`. Never return raw upstream error bodies.
- Google geocoding requires signed, short-lived, query-hash-bound nonces and SF-bounds filtering.
- Production geocoding requires Upstash rate limits; missing Redis must fail closed.
- AI proposes; the server disposes. Re-parse and validate proposals before applying them.
- Keep request schemas strict, body sizes capped, and rendered URLs limited to validated http/https URLs.

## Storage

Use `lib/storage/` wrappers only; do not touch `window.localStorage` directly in feature code. For signed-in users, browser storage is only for ephemeral UI state and the browser-local OpenAI key, not durable map/listing/planning source of truth.

Browser keys are namespaced as `sf-apt-hunt:...`:

- `map-state:v1`
- `geocode-cache:v1`
- `openai-key`
- `geocode-session:v1`

## Style

- Use Zod at data boundaries. Avoid `any`; prefer narrowing over `as`.
- Use string-literal unions and `z.enum` for fixed sets.
- Keep map-state updates immutable with `structuredClone` and spreads.
- Log unexpected failures with module context. Safe defaults are fine for browser-storage failures.
- Use Tailwind CSS 4 and `cn()` from `lib/utils`; preserve mobile usability and the `lg:` map/sidebar split.

## Commands

```bash
npm run dev          # Dev server on http://localhost:3333
npm start            # Production server on port 3333
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test         # Vitest unit + route tests
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright E2E on port 3333
```

Use the full suite for broad changes: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run build`.

## Environment

Required for signed-in persistence: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Required for production listing geocoding: `GOOGLE_MAPS_API_KEY`, `GEOCODE_NONCE_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

Optional: `OPENAI_MODEL`, `NEXT_PUBLIC_TILE_URL`, `NEXT_PUBLIC_TILE_ATTRIBUTION`.

The public app uses no server-owned OpenAI key. Each visitor supplies their own in the UI. Keep Google, nonce, and Upstash secrets server-only.

## Commits

- Use short, imperative commit messages. Semantic prefixes are fine when useful.
- Do **not** add generated-by-agent language or AI-tool co-author trailers, including Codex or Claude.
- Before committing code changes, run and fix failures from relevant verification commands.
