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

This app is designed as a public, anonymous, local-first tool. It does not have an app database or user accounts; map edits, geocode cache entries, and optional remembered OpenAI keys live in the user's browser storage.

For a serverless or public deployment:

- Set the production geocoding variables above before enabling listing pin geocoding.
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
