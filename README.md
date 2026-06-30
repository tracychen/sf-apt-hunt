# SF Apartment Hunt

Interactive SF apartment-search map for San Francisco. The app combines local map edits, a BYO OpenAI assistant, sourced listing research, and protected Google Geocoding for listing pins.

## Local Development

Install dependencies and start the Next.js dev server:

```bash
npm install
npm run dev
```

Open http://localhost:3333.

The base map and local editing tools run without service credentials. AI assistant and listing search requests require each user to enter an OpenAI API key in the app. Real listing geocoding also requires the Google, nonce, and Redis environment variables below.

## Environment Variables

Required for production listing geocoding:

- `GOOGLE_MAPS_API_KEY`: server-only Google Geocoding API key restricted to the Geocoding API.
- `GEOCODE_NONCE_SECRET`: server-only signing secret for short-lived geocoding nonces.
- `UPSTASH_REDIS_REST_URL`: Redis-compatible rate-limit store URL.
- `UPSTASH_REDIS_REST_TOKEN`: Redis-compatible rate-limit store token.

Optional:

- `OPENAI_MODEL`: OpenAI Responses API model, default `gpt-5.5`.
- `NEXT_PUBLIC_TILE_URL`: OpenStreetMap-compatible tile URL.
- `NEXT_PUBLIC_TILE_ATTRIBUTION`: attribution for the configured tile source.

## Persistent Account Setup

Signed-in persistence uses Better Auth, Google OAuth, Drizzle, and Neon Postgres.

Required environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

After changing the Drizzle schema, generate and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

The signed-in app stores workspace map state, listing leads, geocode cache entries, and planning chat state in Postgres. The OpenAI API key remains browser-local.

### Facebook saver extension local setup

1. Start the app with `npm run dev`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose "Load unpacked" and select the repository `extension/` directory.
5. Copy the loaded extension id.
6. Set `EXTENSION_ALLOWED_IDS=<copied id>` in `.env.local`.
7. Restart `npm run dev`.
8. In the extension popup, click `Connect Apt Hunt`.
9. Add a Facebook group to the allowlist.
10. Open a group post and click `Save to Apt Hunt`.

## OpenAI Key Behavior

The public app does not use a server-owned OpenAI key. Each visitor provides their own key in the UI before using assistant or listing search features.

By default, the key is stored in `sessionStorage` for the current browser session. Selecting "Remember on this device" stores it in `localStorage` on that browser only. The key is sent to the server as a bearer token for each assistant or listing request. The server forwards it to OpenAI for that request and does not store, log, or echo it. OpenAI requests are sent with `store: false`.

## Google Geocoding Guardrails

Google Geocoding uses the server-owned `GOOGLE_MAPS_API_KEY`. The geocoding route only accepts candidate/query pairs signed by a recent listing search nonce, filters geocode results to San Francisco bounds, and requires a Redis-compatible rate-limit store in production.

For Google Cloud:

- Restrict `GOOGLE_MAPS_API_KEY` to the Geocoding API.
- Add application restrictions where your deployment supports them, such as fixed egress IP restrictions.
- Set daily quota limits that match expected public usage.
- Configure billing and usage alerts before exposing a public URL.
- Rotate the key if it is exposed or if logs from an external platform show unexpected usage.

## Map Tiles

The default base map uses OpenStreetMap-compatible tiles and visible attribution. Do not prefetch, bulk download, or cache tiles offline unless your tile provider explicitly allows it.

For higher public traffic, configure a paid or otherwise appropriate tile provider with `NEXT_PUBLIC_TILE_URL` and `NEXT_PUBLIC_TILE_ATTRIBUTION`. These values are public browser configuration, so do not put secrets in them. Make sure the attribution text satisfies the tile provider's license and terms.

## Listing Search Policy

Listing search uses OpenAI hosted web search and returns source-linked listing candidates. The app does not scrape Zillow, Craigslist, Apartments.com, or listing sites directly.

Treat listing data as research leads, not final facts. Users must click through to source sites to verify price, availability, lease terms, furnished or short-term status, fees, and exact location before contacting a landlord or broker.

## Public Deployment Caveats

This app supports two deployment modes:

- Signed-out local mode stays public, anonymous, and local-first. Map edits, geocode cache entries, and optional remembered OpenAI keys live in the user's browser storage.
- Signed-in persistent mode adds Google OAuth plus a Postgres-backed workspace for saved map state, listing leads, geocode cache entries, and planning chat state. The OpenAI API key still stays in browser storage.

For a serverless or public deployment:

- Set the production geocoding variables above before enabling listing pin geocoding.
- Add the persistent account variables above before enabling signed-in persistence.
- Keep `GOOGLE_MAPS_API_KEY`, `GEOCODE_NONCE_SECRET`, and Upstash credentials server-only.
- Use HTTPS so browser storage and bearer-token requests are not sent over plaintext.
- Expect serverless route handlers to be stateless; Redis is the production rate-limit authority.
- Monitor OpenAI, Google Geocoding, Redis, and tile-provider usage after launch.
- Review platform logs and redaction settings so request headers and upstream error bodies do not expose user-provided keys.

## Verification

Run the final verification suite before shipping changes:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```
