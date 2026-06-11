# SF Apartment Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved public, anonymous, local-first SF apartment-search map with editable Leaflet geometry, BYO OpenAI Responses API calls, protected Google geocoding, listing results, and docs.

**Architecture:** Keep the App Router page as a thin Server Component and move interactive work into focused Client Components. Keep domain contracts and validation in shared `lib/` modules, server-only API integrations in `lib/server/`, and route handlers under `app/api/**/route.ts`. Keep map state browser-local in v1; no shared app database.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/base-lyra primitives, Base UI, Phosphor icons, Leaflet, React Leaflet, Leaflet Geoman, Zod, OpenAI Responses API, Google Geocoding, Upstash Redis-compatible rate limiting, Vitest, Playwright.

---

## Pre-Execution Notes

- The repo may contain unrelated uncommitted scaffold work in `app/globals.css`, `app/layout.tsx`, `package.json`, `package-lock.json`, `components.json`, `components/`, and `lib/`. Do not revert it.
- Before execution, run `git status --short` and record the dirty files in the task notes.
- The repo-specific rule requires reading relevant guides in `node_modules/next/dist/docs/` before writing Next.js code. For this plan, read:
  - `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`
- Use Node.js runtime for route handlers. Do not set Edge runtime.
- Do not add generated-by or co-author commit metadata.

## File Structure

Create or modify these files:

- `package.json`: add runtime/test dependencies and scripts.
- `vitest.config.ts`: Vitest config for unit and route tests.
- `playwright.config.ts`: Playwright config with stable local dev server.
- `tests/setup/vitest.ts`: shared test setup and environment reset.
- `lib/domain/types.ts`: shared TypeScript domain types.
- `lib/domain/schemas.ts`: Zod runtime schemas.
- `lib/map/sf-bounds.ts`: SF coordinate bounds and geometry helpers.
- `lib/map/seed-data.ts`: local seed zones, corridors, targets, and caution zones.
- `lib/map/proposals.ts`: proposal validation and application logic.
- `lib/storage/api-key-storage.ts`: client-side OpenAI key storage helpers.
- `lib/storage/map-storage.ts`: local map state and geocode cache storage helpers.
- `lib/server/redaction.ts`: secret redaction helpers.
- `lib/server/openai.ts`: OpenAI client construction and response parsing helpers.
- `lib/server/geocode-auth.ts`: signed geocode authorization nonce helpers.
- `lib/server/rate-limit.ts`: Redis-backed geocoding rate limiter.
- `lib/server/google-geocode.ts`: Google Geocoding fetch and SF-bound filtering.
- `app/api/map/apply-proposal/route.ts`: proposal validation route.
- `app/api/geocode/listing/route.ts`: protected geocoding route.
- `app/api/ai/map-assistant/route.ts`: map assistant route.
- `app/api/ai/listing-search/route.ts`: listing search route.
- `components/apartment-map/apartment-map-app.tsx`: top-level Client Component for map app state.
- `components/apartment-map/leaflet-map.tsx`: Leaflet rendering and edit integration.
- `components/apartment-map/sidebar.tsx`: filters, selected details, assistant, and listings layout.
- `components/apartment-map/api-key-dialog.tsx`: BYO OpenAI key UI.
- `components/apartment-map/assistant-panel.tsx`: natural-language assistant UI.
- `components/apartment-map/proposal-review-dialog.tsx`: suggest-then-apply review UI.
- `components/apartment-map/listing-results.tsx`: sourced listing cards and citation links.
- `app/page.tsx`: replace starter page with the app shell.
- `app/layout.tsx`: set metadata for the apartment map.
- `app/globals.css`: add Leaflet/Geoman CSS imports and app layout styles.
- `README.md`: setup, env vars, quota, deployment, and usage guide.
- `tests/unit/**/*.test.ts`: domain, storage, proposal, nonce, redaction, and geocoding tests.
- `tests/routes/**/*.test.ts`: route handler tests with mocked external calls.
- `tests/e2e/apartment-map.spec.ts`: browser tests for the primary UI flows.

---

## Task 1: Add Tooling And Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup/vitest.ts`

- [ ] **Step 1: Review current dependency state**

Run:

```bash
git status --short
cat package.json
```

Expected: working tree may be dirty from existing scaffold work. Do not revert dirty files.

- [ ] **Step 2: Install runtime dependencies**

Run:

```bash
npm install leaflet react-leaflet @geoman-io/leaflet-geoman-free zod openai @upstash/redis
```

Expected: `package.json` and `package-lock.json` include the new runtime dependencies.

- [ ] **Step 3: Install test dependencies**

Run:

```bash
npm install -D vitest @playwright/test jsdom
```

Expected: `package.json` and `package-lock.json` include the new dev dependencies.

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts to this shape while preserving existing scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit --pretty false",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup/vitest.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/routes/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Create Vitest setup**

Create `tests/setup/vitest.ts`:

```ts
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
```

- [ ] **Step 7: Create Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3333",
    viewport: { width: 1440, height: 1000 },
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3333",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

- [ ] **Step 8: Verify tooling**

Run:

```bash
npm run lint
npm run typecheck
npm run test
```

Expected:

- `npm run lint`: exits 0.
- `npm run typecheck`: exits 0.
- `npm run test`: exits 0 with "No test files found" or equivalent until tests are added.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts playwright.config.ts tests/setup/vitest.ts
git commit -m "Add test and map dependencies"
```

---

## Task 2: Define Domain Contracts And Runtime Schemas

**Files:**
- Create: `lib/domain/types.ts`
- Create: `lib/domain/schemas.ts`
- Create: `tests/unit/domain-schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `tests/unit/domain-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  listingSearchResponseSchema,
  mapPatchProposalSchema,
  mapZoneSchema,
  targetCorridorSchema,
  targetPointSchema,
} from "@/lib/domain/schemas";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-122.43, 37.77],
      [-122.42, 37.77],
      [-122.42, 37.76],
      [-122.43, 37.76],
      [-122.43, 37.77],
    ],
  ],
};

describe("domain schemas", () => {
  it("validates a map zone", () => {
    expect(() =>
      mapZoneSchema.parse({
        id: "mission-dolores-valencia",
        name: "Mission Dolores / Valencia",
        kind: "neighborhood",
        geometry: polygon,
        fitnessScore: 5,
        affordabilityScore: 3,
        carFreeScore: 5,
        notes: ["Strong car-free access."],
      }),
    ).not.toThrow();
  });

  it("rejects an invalid priority", () => {
    expect(() =>
      targetCorridorSchema.parse({
        id: "valencia",
        name: "Valencia",
        geometry: {
          type: "LineString",
          coordinates: [
            [-122.421, 37.752],
            [-122.421, 37.769],
          ],
        },
        priority: "urgent",
        tags: ["fitness"],
        notes: [],
      }),
    ).toThrow();
  });

  it("validates target coordinates as longitude latitude", () => {
    expect(() =>
      targetPointSchema.parse({
        id: "fillmore-california",
        name: "Fillmore & California",
        coordinates: [-122.433, 37.789],
        priority: "high",
        notes: [],
      }),
    ).not.toThrow();
  });

  it("requires whyItFits on listing candidates", () => {
    expect(() =>
      listingSearchResponseSchema.parse({
        candidates: [
          {
            id: "listing-1",
            title: "Studio near Fillmore",
            url: "https://example.com/listing-1",
            sourceDomain: "example.com",
            neighborhoodGuess: "Lower Pac Heights",
            locationText: "Fillmore St near California St",
            geocodeQuery: "Fillmore St and California St, San Francisco, CA",
            locationConfidence: "medium",
            coordinates: null,
            geocodeStatus: "not_attempted",
            markerPrecision: "none",
            priceMonthly: 2850,
            beds: "studio",
            shortTermSignal: false,
            furnishedSignal: false,
            fitScore: 4,
            whyItFits: "Within budget and close to target corridor.",
            citations: [
              {
                url: "https://example.com/listing-1",
                title: "Studio near Fillmore",
                sourceDomain: "example.com",
              },
            ],
            caveats: ["Verify availability on source site."],
          },
        ],
        sourceSummary: "One matching listing was found.",
        citations: [
          {
            url: "https://example.com/listing-1",
            title: "Studio near Fillmore",
            sourceDomain: "example.com",
          },
        ],
        caveats: ["Listings can be stale."],
        geocodeAuthorization: {
          nonce: "signed-token",
          expiresAt: "2026-06-11T12:00:00.000Z",
          maxAttempts: 1,
          allowedQueries: [
            {
              candidateId: "listing-1",
              geocodeQueryHash: "hash",
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("validates priority proposal operations", () => {
    expect(() =>
      mapPatchProposalSchema.parse({
        summary: "Raise Valencia priority.",
        operations: [
          {
            type: "updateCorridorPriority",
            corridorId: "valencia",
            priority: "high",
            reason: "Best fitness and transit fit.",
          },
        ],
        confidence: "high",
        requiresUserReview: true,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -- tests/unit/domain-schemas.test.ts
```

Expected: FAIL because `@/lib/domain/schemas` does not exist.

- [ ] **Step 3: Create shared types**

Create `lib/domain/types.ts`:

```ts
export type Priority = "high" | "medium" | "low";
export type Score = 1 | 2 | 3 | 4 | 5;

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: number[][][];
};

export type LineStringGeometry = {
  type: "LineString";
  coordinates: number[][];
};

export type MapZone = {
  id: string;
  name: string;
  kind: "neighborhood" | "caution";
  geometry: PolygonGeometry;
  fitnessScore: Score;
  affordabilityScore: Score;
  carFreeScore: Score;
  notes: string[];
};

export type TargetCorridor = {
  id: string;
  name: string;
  geometry: LineStringGeometry;
  priority: Priority;
  tags: Array<"fitness" | "rent" | "transit" | "safety" | "short-term">;
  notes: string[];
};

export type TargetPoint = {
  id: string;
  name: string;
  coordinates: [number, number];
  priority: Priority;
  notes: string[];
};

export type SourceCitation = {
  url: string;
  title: string | null;
  sourceDomain: string;
};

export type GeocodeAuthorization = {
  nonce: string;
  expiresAt: string;
  maxAttempts: number;
  allowedQueries: Array<{
    candidateId: string;
    geocodeQueryHash: string;
  }>;
};

export type ListingCandidate = {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  neighborhoodGuess: string;
  locationText: string | null;
  geocodeQuery: string | null;
  locationConfidence: "none" | "low" | "medium" | "high";
  coordinates: [number, number] | null;
  geocodeStatus:
    | "not_attempted"
    | "geocoded_exact"
    | "geocoded_approximate"
    | "failed"
    | "outside_sf";
  markerPrecision: "none" | "exact" | "approximate";
  priceMonthly: number | null;
  beds: "studio" | "1br" | "unknown";
  shortTermSignal: boolean;
  furnishedSignal: boolean;
  fitScore: Score;
  whyItFits: string;
  citations: SourceCitation[];
  caveats: string[];
};

export type ListingSearchResponse = {
  candidates: ListingCandidate[];
  sourceSummary: string;
  citations: SourceCitation[];
  caveats: string[];
  geocodeAuthorization: GeocodeAuthorization | null;
};

export type MapPatchProposal = {
  summary: string;
  operations: Array<
    | { type: "addTarget"; target: TargetPoint }
    | { type: "addCorridor"; corridor: TargetCorridor }
    | {
        type: "updateCorridorPriority";
        corridorId: string;
        priority: Priority;
        reason: string;
      }
    | {
        type: "updateTargetPriority";
        targetId: string;
        priority: Priority;
        reason: string;
      }
    | {
        type: "updateZoneScores";
        zoneId: string;
        fitnessScore?: number;
        affordabilityScore?: number;
        carFreeScore?: number;
      }
    | {
        type: "replaceZoneGeometry";
        zoneId: string;
        geometry: PolygonGeometry;
        reason: string;
      }
    | { type: "addNote"; entityId: string; note: string }
  >;
  confidence: "low" | "medium" | "high";
  requiresUserReview: true;
};

export type MapState = {
  zones: MapZone[];
  corridors: TargetCorridor[];
  targets: TargetPoint[];
};
```

- [ ] **Step 4: Create runtime schemas**

Create `lib/domain/schemas.ts`:

```ts
import { z } from "zod";

const scoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const prioritySchema = z.enum(["high", "medium", "low"]);

const coordinateSchema = z.tuple([z.number(), z.number()]);

export const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(coordinateSchema)).min(1),
});

export const lineStringGeometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(coordinateSchema).min(2),
});

export const mapZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["neighborhood", "caution"]),
  geometry: polygonGeometrySchema,
  fitnessScore: scoreSchema,
  affordabilityScore: scoreSchema,
  carFreeScore: scoreSchema,
  notes: z.array(z.string()),
});

export const targetCorridorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  geometry: lineStringGeometrySchema,
  priority: prioritySchema,
  tags: z.array(z.enum(["fitness", "rent", "transit", "safety", "short-term"])),
  notes: z.array(z.string()),
});

export const targetPointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  coordinates: coordinateSchema,
  priority: prioritySchema,
  notes: z.array(z.string()),
});

export const sourceCitationSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  sourceDomain: z.string().min(1),
});

export const geocodeAuthorizationSchema = z.object({
  nonce: z.string().min(1),
  expiresAt: z.string().datetime(),
  maxAttempts: z.number().int().positive(),
  allowedQueries: z.array(
    z.object({
      candidateId: z.string().min(1),
      geocodeQueryHash: z.string().min(1),
    }),
  ),
});

export const listingCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  sourceDomain: z.string().min(1),
  neighborhoodGuess: z.string().min(1),
  locationText: z.string().nullable(),
  geocodeQuery: z.string().nullable(),
  locationConfidence: z.enum(["none", "low", "medium", "high"]),
  coordinates: coordinateSchema.nullable(),
  geocodeStatus: z.enum([
    "not_attempted",
    "geocoded_exact",
    "geocoded_approximate",
    "failed",
    "outside_sf",
  ]),
  markerPrecision: z.enum(["none", "exact", "approximate"]),
  priceMonthly: z.number().int().positive().nullable(),
  beds: z.enum(["studio", "1br", "unknown"]),
  shortTermSignal: z.boolean(),
  furnishedSignal: z.boolean(),
  fitScore: scoreSchema,
  whyItFits: z.string().min(1),
  citations: z.array(sourceCitationSchema).min(1),
  caveats: z.array(z.string()),
});

export const listingSearchResponseSchema = z.object({
  candidates: z.array(listingCandidateSchema),
  sourceSummary: z.string(),
  citations: z.array(sourceCitationSchema),
  caveats: z.array(z.string()),
  geocodeAuthorization: geocodeAuthorizationSchema.nullable(),
});

export const mapPatchProposalSchema = z.object({
  summary: z.string().min(1),
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("addTarget"), target: targetPointSchema }),
      z.object({ type: z.literal("addCorridor"), corridor: targetCorridorSchema }),
      z.object({
        type: z.literal("updateCorridorPriority"),
        corridorId: z.string().min(1),
        priority: prioritySchema,
        reason: z.string().min(1),
      }),
      z.object({
        type: z.literal("updateTargetPriority"),
        targetId: z.string().min(1),
        priority: prioritySchema,
        reason: z.string().min(1),
      }),
      z.object({
        type: z.literal("updateZoneScores"),
        zoneId: z.string().min(1),
        fitnessScore: scoreSchema.optional(),
        affordabilityScore: scoreSchema.optional(),
        carFreeScore: scoreSchema.optional(),
      }),
      z.object({
        type: z.literal("replaceZoneGeometry"),
        zoneId: z.string().min(1),
        geometry: polygonGeometrySchema,
        reason: z.string().min(1),
      }),
      z.object({
        type: z.literal("addNote"),
        entityId: z.string().min(1),
        note: z.string().min(1),
      }),
    ]),
  ),
  confidence: z.enum(["low", "medium", "high"]),
  requiresUserReview: z.literal(true),
});

export const mapStateSchema = z.object({
  zones: z.array(mapZoneSchema),
  corridors: z.array(targetCorridorSchema),
  targets: z.array(targetPointSchema),
});
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- tests/unit/domain-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run lint and typecheck**

```bash
npm run lint
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/domain/types.ts lib/domain/schemas.ts tests/unit/domain-schemas.test.ts
git commit -m "Add apartment map domain schemas"
```

---

## Task 3: Add SF Bounds, Seed Data, And Proposal Application

**Files:**
- Create: `lib/map/sf-bounds.ts`
- Create: `lib/map/seed-data.ts`
- Create: `lib/map/proposals.ts`
- Create: `tests/unit/map-proposals.test.ts`
- Create: `tests/unit/seed-data.test.ts`

- [ ] **Step 1: Write failing proposal tests**

Create `tests/unit/map-proposals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyProposal } from "@/lib/map/proposals";
import { seedMapState } from "@/lib/map/seed-data";

describe("applyProposal", () => {
  it("applies a valid addTarget operation", () => {
    const result = applyProposal(seedMapState, {
      summary: "Add 16th and Mission.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "sixteenth-mission",
            name: "16th & Mission",
            coordinates: [-122.4197, 37.7651],
            priority: "medium",
            notes: ["Transit hub; inspect block-by-block."],
          },
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.targets.some((target) => target.id === "sixteenth-mission")).toBe(true);
    }
  });

  it("rejects invalid coordinates", () => {
    const result = applyProposal(seedMapState, {
      summary: "Bad point.",
      operations: [
        {
          type: "addTarget",
          target: {
            id: "bad",
            name: "Bad",
            coordinates: [-73.9857, 40.7484],
            priority: "low",
            notes: [],
          },
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects unknown zone IDs", () => {
    const result = applyProposal(seedMapState, {
      summary: "Unknown zone.",
      operations: [
        {
          type: "updateZoneScores",
          zoneId: "not-real",
          fitnessScore: 5,
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects replacement geometry outside SF", () => {
    const result = applyProposal(seedMapState, {
      summary: "Move zone outside SF.",
      operations: [
        {
          type: "replaceZoneGeometry",
          zoneId: "lower-pac-heights",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-73.99, 40.75],
                [-73.98, 40.75],
                [-73.98, 40.74],
                [-73.99, 40.74],
                [-73.99, 40.75],
              ],
            ],
          },
          reason: "Invalid test geometry.",
        },
      ],
      confidence: "low",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(false);
  });

  it("updates corridor and target priority", () => {
    const result = applyProposal(seedMapState, {
      summary: "Prioritize Valencia.",
      operations: [
        {
          type: "updateCorridorPriority",
          corridorId: "valencia",
          priority: "high",
          reason: "Fitness density.",
        },
        {
          type: "updateTargetPriority",
          targetId: "valencia-20th",
          priority: "high",
          reason: "Central to selected search.",
        },
      ],
      confidence: "high",
      requiresUserReview: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.corridors.find((corridor) => corridor.id === "valencia")?.priority).toBe("high");
      expect(result.state.targets.find((target) => target.id === "valencia-20th")?.priority).toBe("high");
    }
  });
});
```

- [ ] **Step 2: Write failing seed validation tests**

Create `tests/unit/seed-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapStateSchema } from "@/lib/domain/schemas";
import { isCoordinateInSfBounds } from "@/lib/map/sf-bounds";
import { seedMapState } from "@/lib/map/seed-data";

describe("seedMapState", () => {
  it("validates against the map state schema", () => {
    expect(() => mapStateSchema.parse(seedMapState)).not.toThrow();
  });

  it("contains all v1 zones", () => {
    expect(seedMapState.zones.map((zone) => zone.id).sort()).toEqual([
      "lower-haight-duboce-hayes",
      "lower-pac-heights",
      "marina-cow-hollow",
      "mission-dolores-valencia",
      "nob-hill-polk-gulch",
      "panhandle-nopa",
      "van-ness-lower-russian-hill",
    ]);
  });

  it("keeps all target points inside SF bounds", () => {
    for (const target of seedMapState.targets) {
      expect(isCoordinateInSfBounds(target.coordinates)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npm run test -- tests/unit/map-proposals.test.ts tests/unit/seed-data.test.ts
```

Expected: FAIL because map modules do not exist.

- [ ] **Step 4: Create SF bounds helpers**

Create `lib/map/sf-bounds.ts`:

```ts
import type { LineStringGeometry, PolygonGeometry } from "@/lib/domain/types";

const SF_BOUNDS = {
  minLng: -122.53,
  maxLng: -122.35,
  minLat: 37.69,
  maxLat: 37.84,
};

export function isCoordinateInSfBounds(coordinate: readonly [number, number] | number[]) {
  const [lng, lat] = coordinate;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= SF_BOUNDS.minLng &&
    lng <= SF_BOUNDS.maxLng &&
    lat >= SF_BOUNDS.minLat &&
    lat <= SF_BOUNDS.maxLat
  );
}

export function isPolygonInSfBounds(geometry: PolygonGeometry) {
  return geometry.coordinates.every((ring) => ring.every(isCoordinateInSfBounds));
}

export function isLineStringInSfBounds(geometry: LineStringGeometry) {
  return geometry.coordinates.every(isCoordinateInSfBounds);
}

export function closePolygonRing(ring: Array<[number, number]>) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return ring;
  }
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }
  return [...ring, first];
}
```

- [ ] **Step 5: Create seed map data**

Create `lib/map/seed-data.ts` with exact IDs used by the tests:

```ts
import type { MapState } from "@/lib/domain/types";

export const seedMapState: MapState = {
  zones: [
    {
      id: "marina-cow-hollow",
      name: "Marina / Cow Hollow",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.452, 37.809], [-122.426, 37.809], [-122.426, 37.795], [-122.452, 37.795], [-122.452, 37.809]]],
      },
      fitnessScore: 5,
      affordabilityScore: 2,
      carFreeScore: 3,
      notes: ["Strong boutique fitness access; rents trend higher."],
    },
    {
      id: "lower-pac-heights",
      name: "Lower Pac Heights",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.444, 37.794], [-122.421, 37.794], [-122.421, 37.781], [-122.444, 37.781], [-122.444, 37.794]]],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Good Fillmore access and central bus corridors."],
    },
    {
      id: "mission-dolores-valencia",
      name: "Mission Dolores / Valencia",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.432, 37.77], [-122.415, 37.77], [-122.415, 37.752], [-122.432, 37.752], [-122.432, 37.77]]],
      },
      fitnessScore: 5,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Best car-free access and strong studio/fitness density."],
    },
    {
      id: "lower-haight-duboce-hayes",
      name: "Lower Haight / Duboce / Hayes",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.438, 37.78], [-122.419, 37.78], [-122.419, 37.768], [-122.438, 37.768], [-122.438, 37.78]]],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 5,
      notes: ["Central, transit-rich, and strong access to Hayes and Castro edges."],
    },
    {
      id: "nob-hill-polk-gulch",
      name: "Nob Hill / Polk Gulch",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.425, 37.799], [-122.408, 37.799], [-122.408, 37.786], [-122.425, 37.786], [-122.425, 37.799]]],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Dense rental stock and strong Polk corridor access."],
    },
    {
      id: "panhandle-nopa",
      name: "Panhandle / NOPA",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.458, 37.782], [-122.432, 37.782], [-122.432, 37.769], [-122.458, 37.769], [-122.458, 37.782]]],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Good park access and Divisadero corridor options."],
    },
    {
      id: "van-ness-lower-russian-hill",
      name: "Van Ness / Lower Russian Hill",
      kind: "neighborhood",
      geometry: {
        type: "Polygon",
        coordinates: [[[-122.426, 37.807], [-122.416, 37.807], [-122.416, 37.792], [-122.426, 37.792], [-122.426, 37.807]]],
      },
      fitnessScore: 4,
      affordabilityScore: 3,
      carFreeScore: 4,
      notes: ["Central north-side access with Van Ness transit."],
    },
  ],
  corridors: [
    {
      id: "valencia",
      name: "Valencia Street",
      geometry: { type: "LineString", coordinates: [[-122.421, 37.752], [-122.421, 37.769]] },
      priority: "high",
      tags: ["fitness", "rent", "transit"],
      notes: ["Core Mission target corridor."],
    },
    {
      id: "fillmore",
      name: "Fillmore Street",
      geometry: { type: "LineString", coordinates: [[-122.433, 37.781], [-122.433, 37.794]] },
      priority: "high",
      tags: ["fitness", "transit"],
      notes: ["Lower Pac Heights and Japantown access."],
    },
    {
      id: "polk",
      name: "Polk Street",
      geometry: { type: "LineString", coordinates: [[-122.421, 37.786], [-122.421, 37.802]] },
      priority: "medium",
      tags: ["fitness", "rent"],
      notes: ["Dense rental and services corridor."],
    },
  ],
  targets: [
    {
      id: "fillmore-california",
      name: "Fillmore & California",
      coordinates: [-122.433, 37.789],
      priority: "high",
      notes: ["Lower Pac Heights reference point."],
    },
    {
      id: "valencia-20th",
      name: "Valencia & 20th",
      coordinates: [-122.421, 37.758],
      priority: "high",
      notes: ["Mission Dolores / Valencia reference point."],
    },
    {
      id: "polk-sacramento",
      name: "Polk & Sacramento",
      coordinates: [-122.421, 37.792],
      priority: "medium",
      notes: ["Polk Gulch reference point."],
    },
  ],
};
```

- [ ] **Step 6: Create proposal application logic**

Create `lib/map/proposals.ts`:

```ts
import { mapPatchProposalSchema } from "@/lib/domain/schemas";
import type { MapPatchProposal, MapState } from "@/lib/domain/types";
import {
  isCoordinateInSfBounds,
  isLineStringInSfBounds,
  isPolygonInSfBounds,
} from "@/lib/map/sf-bounds";

export type ProposalApplyResult =
  | { ok: true; state: MapState }
  | { ok: false; error: string };

export function applyProposal(state: MapState, proposal: MapPatchProposal): ProposalApplyResult {
  const parsed = mapPatchProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return { ok: false, error: "Invalid proposal shape." };
  }

  let nextState: MapState = structuredClone(state);

  for (const operation of proposal.operations) {
    switch (operation.type) {
      case "addTarget": {
        if (!isCoordinateInSfBounds(operation.target.coordinates)) {
          return { ok: false, error: "Target coordinates are outside San Francisco." };
        }
        if (nextState.targets.some((target) => target.id === operation.target.id)) {
          return { ok: false, error: "Target ID already exists." };
        }
        nextState = { ...nextState, targets: [...nextState.targets, operation.target] };
        break;
      }
      case "addCorridor": {
        if (!isLineStringInSfBounds(operation.corridor.geometry)) {
          return { ok: false, error: "Corridor geometry is outside San Francisco." };
        }
        if (nextState.corridors.some((corridor) => corridor.id === operation.corridor.id)) {
          return { ok: false, error: "Corridor ID already exists." };
        }
        nextState = { ...nextState, corridors: [...nextState.corridors, operation.corridor] };
        break;
      }
      case "updateCorridorPriority": {
        if (!nextState.corridors.some((corridor) => corridor.id === operation.corridorId)) {
          return { ok: false, error: "Unknown corridor ID." };
        }
        nextState = {
          ...nextState,
          corridors: nextState.corridors.map((corridor) =>
            corridor.id === operation.corridorId
              ? { ...corridor, priority: operation.priority, notes: [...corridor.notes, operation.reason] }
              : corridor,
          ),
        };
        break;
      }
      case "updateTargetPriority": {
        if (!nextState.targets.some((target) => target.id === operation.targetId)) {
          return { ok: false, error: "Unknown target ID." };
        }
        nextState = {
          ...nextState,
          targets: nextState.targets.map((target) =>
            target.id === operation.targetId
              ? { ...target, priority: operation.priority, notes: [...target.notes, operation.reason] }
              : target,
          ),
        };
        break;
      }
      case "updateZoneScores": {
        if (!nextState.zones.some((zone) => zone.id === operation.zoneId)) {
          return { ok: false, error: "Unknown zone ID." };
        }
        nextState = {
          ...nextState,
          zones: nextState.zones.map((zone) =>
            zone.id === operation.zoneId
              ? {
                  ...zone,
                  fitnessScore: operation.fitnessScore ?? zone.fitnessScore,
                  affordabilityScore: operation.affordabilityScore ?? zone.affordabilityScore,
                  carFreeScore: operation.carFreeScore ?? zone.carFreeScore,
                }
              : zone,
          ),
        };
        break;
      }
      case "replaceZoneGeometry": {
        if (!isPolygonInSfBounds(operation.geometry)) {
          return { ok: false, error: "Zone geometry is outside San Francisco." };
        }
        if (!nextState.zones.some((zone) => zone.id === operation.zoneId)) {
          return { ok: false, error: "Unknown zone ID." };
        }
        nextState = {
          ...nextState,
          zones: nextState.zones.map((zone) =>
            zone.id === operation.zoneId
              ? { ...zone, geometry: operation.geometry, notes: [...zone.notes, operation.reason] }
              : zone,
          ),
        };
        break;
      }
      case "addNote": {
        const entityFound =
          nextState.zones.some((zone) => zone.id === operation.entityId) ||
          nextState.corridors.some((corridor) => corridor.id === operation.entityId) ||
          nextState.targets.some((target) => target.id === operation.entityId);
        if (!entityFound) {
          return { ok: false, error: "Unknown entity ID." };
        }
        const updatedZones = nextState.zones.map((zone) =>
          zone.id === operation.entityId ? { ...zone, notes: [...zone.notes, operation.note] } : zone,
        );
        const updatedCorridors = nextState.corridors.map((corridor) =>
          corridor.id === operation.entityId ? { ...corridor, notes: [...corridor.notes, operation.note] } : corridor,
        );
        const updatedTargets = nextState.targets.map((target) =>
          target.id === operation.entityId ? { ...target, notes: [...target.notes, operation.note] } : target,
        );
        nextState = { zones: updatedZones, corridors: updatedCorridors, targets: updatedTargets };
        break;
      }
    }
  }

  return { ok: true, state: nextState };
}
```

- [ ] **Step 7: Run tests**

```bash
npm run test -- tests/unit/map-proposals.test.ts tests/unit/seed-data.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run full verification**

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add lib/map/sf-bounds.ts lib/map/seed-data.ts lib/map/proposals.ts tests/unit/map-proposals.test.ts tests/unit/seed-data.test.ts
git commit -m "Add seed map data and proposal application"
```

---

## Task 4: Add Browser Storage Helpers

**Files:**
- Create: `lib/storage/api-key-storage.ts`
- Create: `lib/storage/map-storage.ts`
- Create: `tests/unit/storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `tests/unit/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  loadStoredOpenAiKey,
  saveOpenAiKey,
  clearStoredOpenAiKey,
} from "@/lib/storage/api-key-storage";
import {
  loadMapState,
  saveMapState,
  clearMapState,
  saveGeocodeCacheEntry,
  loadGeocodeCache,
} from "@/lib/storage/map-storage";
import { seedMapState } from "@/lib/map/seed-data";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("api key storage", () => {
  it("uses session storage by default", () => {
    const sessionStorage = createStorage();
    const localStorage = createStorage();

    saveOpenAiKey("sk-test", false, { sessionStorage, localStorage });

    expect(sessionStorage.getItem("sf-apt-hunt:openai-key")).toBe("sk-test");
    expect(localStorage.getItem("sf-apt-hunt:openai-key")).toBeNull();
    expect(loadStoredOpenAiKey({ sessionStorage, localStorage })).toEqual({
      key: "sk-test",
      remembered: false,
    });
  });

  it("uses local storage only when remember is true", () => {
    const sessionStorage = createStorage();
    const localStorage = createStorage();

    saveOpenAiKey("sk-local", true, { sessionStorage, localStorage });

    expect(localStorage.getItem("sf-apt-hunt:openai-key")).toBe("sk-local");
    expect(sessionStorage.getItem("sf-apt-hunt:openai-key")).toBeNull();
    expect(loadStoredOpenAiKey({ sessionStorage, localStorage })).toEqual({
      key: "sk-local",
      remembered: true,
    });
  });

  it("clears both key stores", () => {
    const sessionStorage = createStorage();
    const localStorage = createStorage();

    saveOpenAiKey("sk-local", true, { sessionStorage, localStorage });
    clearStoredOpenAiKey({ sessionStorage, localStorage });

    expect(loadStoredOpenAiKey({ sessionStorage, localStorage })).toEqual({
      key: null,
      remembered: false,
    });
  });
});

describe("map storage", () => {
  it("saves and loads map state", () => {
    const localStorage = createStorage();
    saveMapState(seedMapState, { localStorage });
    expect(loadMapState({ localStorage })).toEqual(seedMapState);
  });

  it("clears map state", () => {
    const localStorage = createStorage();
    saveMapState(seedMapState, { localStorage });
    clearMapState({ localStorage });
    expect(loadMapState({ localStorage })).toBeNull();
  });

  it("stores geocode cache entries by normalized query", () => {
    const localStorage = createStorage();
    saveGeocodeCacheEntry(
      "fillmore and california san francisco ca",
      { coordinates: [-122.433, 37.789], markerPrecision: "approximate" },
      { localStorage },
    );
    expect(loadGeocodeCache({ localStorage })).toEqual({
      "fillmore and california san francisco ca": {
        coordinates: [-122.433, 37.789],
        markerPrecision: "approximate",
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test -- tests/unit/storage.test.ts
```

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Create API key storage helper**

Create `lib/storage/api-key-storage.ts`:

```ts
const OPENAI_KEY_STORAGE_KEY = "sf-apt-hunt:openai-key";

type StoragePair = {
  sessionStorage: Storage;
  localStorage: Storage;
};

function getBrowserStorage(): StoragePair | null {
  if (typeof window === "undefined") {
    return null;
  }
  return { sessionStorage: window.sessionStorage, localStorage: window.localStorage };
}

export function saveOpenAiKey(key: string, remember: boolean, storage = getBrowserStorage()) {
  if (!storage) {
    return;
  }
  storage.sessionStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
  storage.localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
  const target = remember ? storage.localStorage : storage.sessionStorage;
  target.setItem(OPENAI_KEY_STORAGE_KEY, key);
}

export function loadStoredOpenAiKey(storage = getBrowserStorage()) {
  if (!storage) {
    return { key: null, remembered: false };
  }
  const rememberedKey = storage.localStorage.getItem(OPENAI_KEY_STORAGE_KEY);
  if (rememberedKey) {
    return { key: rememberedKey, remembered: true };
  }
  return {
    key: storage.sessionStorage.getItem(OPENAI_KEY_STORAGE_KEY),
    remembered: false,
  };
}

export function clearStoredOpenAiKey(storage = getBrowserStorage()) {
  if (!storage) {
    return;
  }
  storage.sessionStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
  storage.localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
}
```

- [ ] **Step 4: Create map storage helper**

Create `lib/storage/map-storage.ts`:

```ts
import { mapStateSchema } from "@/lib/domain/schemas";
import type { MapState } from "@/lib/domain/types";

const MAP_STATE_KEY = "sf-apt-hunt:map-state:v1";
const GEOCODE_CACHE_KEY = "sf-apt-hunt:geocode-cache:v1";

type LocalStorageOption = {
  localStorage: Storage;
};

function getBrowserLocalStorage(): LocalStorageOption | null {
  if (typeof window === "undefined") {
    return null;
  }
  return { localStorage: window.localStorage };
}

export function saveMapState(state: MapState, storage = getBrowserLocalStorage()) {
  if (!storage) {
    return;
  }
  storage.localStorage.setItem(MAP_STATE_KEY, JSON.stringify(state));
}

export function loadMapState(storage = getBrowserLocalStorage()) {
  if (!storage) {
    return null;
  }
  const rawValue = storage.localStorage.getItem(MAP_STATE_KEY);
  if (!rawValue) {
    return null;
  }
  const parsed = mapStateSchema.safeParse(JSON.parse(rawValue));
  return parsed.success ? parsed.data : null;
}

export function clearMapState(storage = getBrowserLocalStorage()) {
  storage?.localStorage.removeItem(MAP_STATE_KEY);
}

export type GeocodeCacheEntry = {
  coordinates: [number, number];
  markerPrecision: "exact" | "approximate";
};

export type GeocodeCache = Record<string, GeocodeCacheEntry>;

export function loadGeocodeCache(storage = getBrowserLocalStorage()): GeocodeCache {
  if (!storage) {
    return {};
  }
  const rawValue = storage.localStorage.getItem(GEOCODE_CACHE_KEY);
  if (!rawValue) {
    return {};
  }
  return JSON.parse(rawValue) as GeocodeCache;
}

export function saveGeocodeCacheEntry(
  normalizedQuery: string,
  entry: GeocodeCacheEntry,
  storage = getBrowserLocalStorage(),
) {
  if (!storage) {
    return;
  }
  const cache = loadGeocodeCache(storage);
  storage.localStorage.setItem(
    GEOCODE_CACHE_KEY,
    JSON.stringify({ ...cache, [normalizedQuery]: entry }),
  );
}
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- tests/unit/storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run verification**

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/storage/api-key-storage.ts lib/storage/map-storage.ts tests/unit/storage.test.ts
git commit -m "Add local storage helpers"
```

---

## Task 5: Add Server Redaction, Geocode Authorization, And Rate Limiting

**Files:**
- Create: `lib/server/redaction.ts`
- Create: `lib/server/geocode-auth.ts`
- Create: `lib/server/rate-limit.ts`
- Create: `tests/unit/server-security.test.ts`

- [ ] **Step 1: Write failing server-security tests**

Create `tests/unit/server-security.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { redactSecrets } from "@/lib/server/redaction";
import {
  canonicalizeGeocodeQuery,
  createGeocodeAuthorization,
  verifyGeocodeAuthorization,
} from "@/lib/server/geocode-auth";

describe("redactSecrets", () => {
  it("redacts OpenAI style keys recursively", () => {
    expect(
      redactSecrets({
        apiKey: "sk-test-secret",
        nested: { authorization: "Bearer sk-other-secret" },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
  });
});

describe("geocode authorization", () => {
  it("canonicalizes geocode queries", () => {
    expect(canonicalizeGeocodeQuery("  Fillmore  and California ")).toBe(
      "fillmore and california san francisco ca",
    );
  });

  it("accepts signed candidate/query pairs", () => {
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    const authorization = createGeocodeAuthorization({
      secret: "secret",
      candidates: [
        {
          candidateId: "listing-1",
          geocodeQuery: "Fillmore and California, San Francisco, CA",
        },
      ],
      maxAttempts: 1,
      ttlSeconds: 300,
    });

    expect(
      verifyGeocodeAuthorization({
        secret: "secret",
        nonce: authorization.nonce,
        candidateId: "listing-1",
        geocodeQuery: "fillmore and california san francisco ca",
      }).ok,
    ).toBe(true);
  });

  it("rejects tampered queries for valid candidate IDs", () => {
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    const authorization = createGeocodeAuthorization({
      secret: "secret",
      candidates: [
        {
          candidateId: "listing-1",
          geocodeQuery: "Fillmore and California, San Francisco, CA",
        },
      ],
      maxAttempts: 1,
      ttlSeconds: 300,
    });

    expect(
      verifyGeocodeAuthorization({
        secret: "secret",
        nonce: authorization.nonce,
        candidateId: "listing-1",
        geocodeQuery: "1 Infinite Loop Cupertino CA",
      }).ok,
    ).toBe(false);
  });

  it("rejects expired nonces", () => {
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    const authorization = createGeocodeAuthorization({
      secret: "secret",
      candidates: [
        {
          candidateId: "listing-1",
          geocodeQuery: "Fillmore and California, San Francisco, CA",
        },
      ],
      maxAttempts: 1,
      ttlSeconds: 60,
    });

    vi.setSystemTime(new Date("2026-06-11T12:02:00.000Z"));

    expect(
      verifyGeocodeAuthorization({
        secret: "secret",
        nonce: authorization.nonce,
        candidateId: "listing-1",
        geocodeQuery: "Fillmore and California, San Francisco, CA",
      }).ok,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test -- tests/unit/server-security.test.ts
```

Expected: FAIL because server security modules do not exist.

- [ ] **Step 3: Create redaction helper**

Create `lib/server/redaction.ts`:

```ts
const SECRET_KEY_PATTERN = /sk-[A-Za-z0-9_-]+/g;
const SECRET_FIELD_PATTERN = /^(apiKey|authorization|openAiKey|openaiKey|token|secret)$/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_KEY_PATTERN, "[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SECRET_FIELD_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(nestedValue),
      ]),
    );
  }
  return value;
}
```

- [ ] **Step 4: Create geocode authorization helper**

Create `lib/server/geocode-auth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GeocodeAuthorization } from "@/lib/domain/types";

type AuthorizationPayload = {
  expiresAt: string;
  maxAttempts: number;
  allowedQueries: Array<{
    candidateId: string;
    geocodeQueryHash: string;
  }>;
};

function base64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function canonicalizeGeocodeQuery(query: string) {
  const canonical = query.trim().toLowerCase().replace(/\s+/g, " ").replace(/,\s*/g, " ");
  if (canonical.includes("san francisco") || canonical.includes("sf ca")) {
    return canonical;
  }
  return `${canonical} san francisco ca`;
}

export function hashCanonicalGeocodeQuery(query: string) {
  return createHmac("sha256", "sf-apt-hunt-geocode-query").update(canonicalizeGeocodeQuery(query)).digest("hex");
}

export function createGeocodeAuthorization({
  secret,
  candidates,
  maxAttempts,
  ttlSeconds,
}: {
  secret: string;
  candidates: Array<{ candidateId: string; geocodeQuery: string }>;
  maxAttempts: number;
  ttlSeconds: number;
}): GeocodeAuthorization {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const payload: AuthorizationPayload = {
    expiresAt,
    maxAttempts,
    allowedQueries: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      geocodeQueryHash: hashCanonicalGeocodeQuery(candidate.geocodeQuery),
    })),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return {
    nonce: `${encodedPayload}.${signature}`,
    expiresAt,
    maxAttempts,
    allowedQueries: payload.allowedQueries,
  };
}

export function verifyGeocodeAuthorization({
  secret,
  nonce,
  candidateId,
  geocodeQuery,
}: {
  secret: string;
  nonce: string;
  candidateId: string;
  geocodeQuery: string;
}): { ok: true; payload: AuthorizationPayload } | { ok: false; error: string } {
  const [encodedPayload, signature] = nonce.split(".");
  if (!encodedPayload || !signature) {
    return { ok: false, error: "Malformed nonce." };
  }
  const expectedSignature = signPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return { ok: false, error: "Invalid nonce signature." };
  }

  const payload = JSON.parse(fromBase64url(encodedPayload)) as AuthorizationPayload;
  if (Date.parse(payload.expiresAt) <= Date.now()) {
    return { ok: false, error: "Expired nonce." };
  }

  const geocodeQueryHash = hashCanonicalGeocodeQuery(geocodeQuery);
  const allowed = payload.allowedQueries.some(
    (query) => query.candidateId === candidateId && query.geocodeQueryHash === geocodeQueryHash,
  );

  if (!allowed) {
    return { ok: false, error: "Geocode query is not authorized." };
  }

  return { ok: true, payload };
}
```

- [ ] **Step 5: Create rate-limit helper**

Create `lib/server/rate-limit.ts`:

```ts
import { Redis } from "@upstash/redis";

type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: string;
};

export function createRedisFromEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  return new Redis({ url, token });
}

export async function checkFixedWindowRateLimit({
  redis,
  key,
  limit,
  windowSeconds,
}: {
  redis: Redis;
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }
  const ttl = await redis.ttl(key);
  return {
    ok: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt: new Date(Date.now() + Math.max(ttl, 0) * 1000).toISOString(),
  };
}
```

- [ ] **Step 6: Run tests**

```bash
npm run test -- tests/unit/server-security.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run verification**

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/server/redaction.ts lib/server/geocode-auth.ts lib/server/rate-limit.ts tests/unit/server-security.test.ts
git commit -m "Add server secret and geocode guards"
```

---

## Task 6: Add Proposal Validation Route

**Files:**
- Create: `app/api/map/apply-proposal/route.ts`
- Create: `tests/routes/apply-proposal-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/routes/apply-proposal-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/map/apply-proposal/route";
import { seedMapState } from "@/lib/map/seed-data";

describe("POST /api/map/apply-proposal", () => {
  it("returns validated state for a valid proposal", async () => {
    const response = await POST(
      new Request("http://localhost/api/map/apply-proposal", {
        method: "POST",
        body: JSON.stringify({
          mapState: seedMapState,
          proposal: {
            summary: "Raise Valencia.",
            operations: [
              {
                type: "updateCorridorPriority",
                corridorId: "valencia",
                priority: "high",
                reason: "Best fit for boutique fitness.",
              },
            ],
            confidence: "high",
            requiresUserReview: true,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects unknown zone IDs", async () => {
    const response = await POST(
      new Request("http://localhost/api/map/apply-proposal", {
        method: "POST",
        body: JSON.stringify({
          mapState: seedMapState,
          proposal: {
            summary: "Bad zone.",
            operations: [{ type: "updateZoneScores", zoneId: "missing", fitnessScore: 5 }],
            confidence: "low",
            requiresUserReview: true,
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test -- tests/routes/apply-proposal-route.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Create route**

Create `app/api/map/apply-proposal/route.ts`:

```ts
import { z } from "zod";
import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import { applyProposal } from "@/lib/map/proposals";
import { redactSecrets } from "@/lib/server/redaction";

const requestSchema = z.object({
  mapState: mapStateSchema,
  proposal: mapPatchProposalSchema,
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = applyProposal(body.mapState, body.proposal);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true, state: result.state });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "Invalid proposal request.",
        details: redactSecrets(error instanceof Error ? error.message : error),
      },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 4: Run route tests**

```bash
npm run test -- tests/routes/apply-proposal-route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run verification**

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/api/map/apply-proposal/route.ts tests/routes/apply-proposal-route.test.ts
git commit -m "Add proposal validation route"
```

---

## Task 7: Add Google Geocoding Service And Protected Route

**Files:**
- Create: `lib/server/google-geocode.ts`
- Create: `app/api/geocode/listing/route.ts`
- Create: `tests/unit/google-geocode.test.ts`
- Create: `tests/routes/geocode-route.test.ts`

- [ ] **Step 1: Write failing Google geocode unit tests**

Create `tests/unit/google-geocode.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { geocodeListingLocation } from "@/lib/server/google-geocode";

describe("geocodeListingLocation", () => {
  it("returns exact coordinates for SF results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "OK",
          results: [
            {
              formatted_address: "Fillmore St & California St, San Francisco, CA 94115, USA",
              geometry: {
                location: { lng: -122.433, lat: 37.789 },
                location_type: "GEOMETRIC_CENTER",
              },
            },
          ],
        }),
      ),
    );

    await expect(
      geocodeListingLocation({
        apiKey: "google-key",
        query: "Fillmore and California, San Francisco, CA",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      coordinates: [-122.433, 37.789],
      markerPrecision: "approximate",
    });
  });

  it("rejects outside-SF results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "OK",
          results: [
            {
              formatted_address: "1 Infinite Loop, Cupertino, CA",
              geometry: {
                location: { lng: -122.031, lat: 37.331 },
                location_type: "ROOFTOP",
              },
            },
          ],
        }),
      ),
    );

    await expect(
      geocodeListingLocation({ apiKey: "google-key", query: "1 Infinite Loop" }),
    ).resolves.toMatchObject({ status: "outside_sf" });
  });
});
```

- [ ] **Step 2: Write failing geocode route tests**

Create `tests/routes/geocode-route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/geocode/listing/route";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/geocode/listing", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.10", "x-sf-apt-session": "session-1" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/geocode/listing", () => {
  it("rejects missing rate limit config in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "secret");

    const authorization = createGeocodeAuthorization({
      secret: "secret",
      candidates: [{ candidateId: "listing-1", geocodeQuery: "Fillmore and California" }],
      maxAttempts: 1,
      ttlSeconds: 300,
    });

    const response = await POST(
      makeRequest({
        nonce: authorization.nonce,
        candidateId: "listing-1",
        geocodeQuery: "Fillmore and California",
      }),
    );

    expect(response.status).toBe(503);
  });

  it("rejects tampered geocode queries", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    vi.stubEnv("GEOCODE_NONCE_SECRET", "secret");

    const authorization = createGeocodeAuthorization({
      secret: "secret",
      candidates: [{ candidateId: "listing-1", geocodeQuery: "Fillmore and California" }],
      maxAttempts: 1,
      ttlSeconds: 300,
    });

    const response = await POST(
      makeRequest({
        nonce: authorization.nonce,
        candidateId: "listing-1",
        geocodeQuery: "1 Infinite Loop Cupertino CA",
      }),
    );

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npm run test -- tests/unit/google-geocode.test.ts tests/routes/geocode-route.test.ts
```

Expected: FAIL because geocoding service and route do not exist.

- [ ] **Step 4: Create Google geocoding service**

Create `lib/server/google-geocode.ts`:

```ts
import { isCoordinateInSfBounds } from "@/lib/map/sf-bounds";

type GoogleGeocodeResponse = {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: {
      location: { lng: number; lat: number };
      location_type: string;
    };
  }>;
};

export async function geocodeListingLocation({
  apiKey,
  query,
}: {
  apiKey: string;
  query: string;
}): Promise<
  | { status: "ok"; coordinates: [number, number]; markerPrecision: "exact" | "approximate"; formattedAddress: string }
  | { status: "failed" | "outside_sf"; error: string }
> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("components", "locality:San Francisco|administrative_area:CA|country:US");

  const response = await fetch(url);
  if (!response.ok) {
    return { status: "failed", error: "Google Geocoding request failed." };
  }

  const data = (await response.json()) as GoogleGeocodeResponse;
  const firstResult = data.results[0];
  if (data.status !== "OK" || !firstResult) {
    return { status: "failed", error: "No geocode result found." };
  }

  const coordinates: [number, number] = [
    firstResult.geometry.location.lng,
    firstResult.geometry.location.lat,
  ];

  if (!isCoordinateInSfBounds(coordinates)) {
    return { status: "outside_sf", error: "Geocode result is outside San Francisco." };
  }

  return {
    status: "ok",
    coordinates,
    markerPrecision: firstResult.geometry.location_type === "ROOFTOP" ? "exact" : "approximate",
    formattedAddress: firstResult.formatted_address,
  };
}
```

- [ ] **Step 5: Create geocode route**

Create `app/api/geocode/listing/route.ts`:

```ts
import { z } from "zod";
import { verifyGeocodeAuthorization } from "@/lib/server/geocode-auth";
import { geocodeListingLocation } from "@/lib/server/google-geocode";
import { checkFixedWindowRateLimit, createRedisFromEnv } from "@/lib/server/rate-limit";
import { redactSecrets } from "@/lib/server/redaction";

const requestSchema = z.object({
  nonce: z.string().min(1),
  candidateId: z.string().min(1),
  geocodeQuery: z.string().min(1),
});

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown-ip";
  const session = request.headers.get("x-sf-apt-session") ?? "unknown-session";
  return `geocode:${forwardedFor}:${session}`;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const nonceSecret = process.env.GEOCODE_NONCE_SECRET;
    if (!apiKey || !nonceSecret) {
      return Response.json({ ok: false, error: "Geocoding is not configured." }, { status: 503 });
    }

    const body = requestSchema.parse(await request.json());
    const verification = verifyGeocodeAuthorization({
      secret: nonceSecret,
      nonce: body.nonce,
      candidateId: body.candidateId,
      geocodeQuery: body.geocodeQuery,
    });
    if (!verification.ok) {
      return Response.json({ ok: false, error: verification.error }, { status: 403 });
    }

    const redis = createRedisFromEnv();
    if (!redis) {
      const status = process.env.NODE_ENV === "production" ? 503 : 200;
      if (status === 503) {
        return Response.json({ ok: false, error: "Rate limiting is not configured." }, { status });
      }
    } else {
      const limit = await checkFixedWindowRateLimit({
        redis,
        key: getClientKey(request),
        limit: 20,
        windowSeconds: 3600,
      });
      if (!limit.ok) {
        return Response.json({ ok: false, error: "Geocoding rate limit exceeded." }, { status: 429 });
      }
    }

    const geocode = await geocodeListingLocation({ apiKey, query: body.geocodeQuery });
    if (geocode.status !== "ok") {
      return Response.json({ ok: false, status: geocode.status, error: geocode.error }, { status: 400 });
    }

    return Response.json({ ok: true, geocode });
  } catch (error) {
    return Response.json(
      { ok: false, error: "Invalid geocode request.", details: redactSecrets(error) },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 6: Run focused tests**

```bash
npm run test -- tests/unit/google-geocode.test.ts tests/routes/geocode-route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run verification**

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/server/google-geocode.ts app/api/geocode/listing/route.ts tests/unit/google-geocode.test.ts tests/routes/geocode-route.test.ts
git commit -m "Add protected listing geocoding route"
```

---

## Task 8: Add OpenAI Route Helpers And AI Routes

**Files:**
- Create: `lib/server/openai.ts`
- Create: `app/api/ai/map-assistant/route.ts`
- Create: `app/api/ai/listing-search/route.ts`
- Create: `tests/routes/map-assistant-route.test.ts`
- Create: `tests/routes/listing-search-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create route tests that mock `global.fetch` for OpenAI calls. The tests must cover:

```ts
import { describe, expect, it, vi } from "vitest";
import { POST as mapAssistantPost } from "@/app/api/ai/map-assistant/route";
import { POST as listingSearchPost } from "@/app/api/ai/listing-search/route";
import { seedMapState } from "@/lib/map/seed-data";

describe("AI routes", () => {
  it("map assistant requires a user OpenAI key", async () => {
    const response = await mapAssistantPost(
      new Request("http://localhost/api/ai/map-assistant", {
        method: "POST",
        body: JSON.stringify({ message: "Make Valencia high priority.", mapState: seedMapState }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("listing search requires a user OpenAI key", async () => {
    const response = await listingSearchPost(
      new Request("http://localhost/api/ai/listing-search", {
        method: "POST",
        body: JSON.stringify({ query: "Find studio under 3000 near Lower Pac Heights.", filters: {} }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("listing search preserves citations from structured output", async () => {
    vi.stubEnv("GEOCODE_NONCE_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          output_text: JSON.stringify({
            candidates: [
              {
                id: "listing-1",
                title: "Studio near Fillmore",
                url: "https://example.com/listing-1",
                sourceDomain: "example.com",
                neighborhoodGuess: "Lower Pac Heights",
                locationText: "Fillmore and California",
                geocodeQuery: "Fillmore and California, San Francisco, CA",
                locationConfidence: "medium",
                coordinates: null,
                geocodeStatus: "not_attempted",
                markerPrecision: "none",
                priceMonthly: 2850,
                beds: "studio",
                shortTermSignal: false,
                furnishedSignal: false,
                fitScore: 4,
                whyItFits: "Under budget near target corridor.",
                citations: [
                  { url: "https://example.com/listing-1", title: "Studio near Fillmore", sourceDomain: "example.com" },
                ],
                caveats: ["Verify availability."],
              },
            ],
            sourceSummary: "One candidate found.",
            citations: [
              { url: "https://example.com/listing-1", title: "Studio near Fillmore", sourceDomain: "example.com" },
            ],
            caveats: ["Listings can be stale."],
            geocodeAuthorization: null,
          }),
        }),
      ),
    );

    const response = await listingSearchPost(
      new Request("http://localhost/api/ai/listing-search", {
        method: "POST",
        headers: { authorization: "Bearer sk-test" },
        body: JSON.stringify({ query: "Find studio under 3000 near Lower Pac Heights.", filters: {} }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates[0].whyItFits).toContain("Under budget");
    expect(body.citations[0].url).toBe("https://example.com/listing-1");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm run test -- tests/routes/map-assistant-route.test.ts tests/routes/listing-search-route.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Create OpenAI helper**

Create `lib/server/openai.ts`:

```ts
export function getOpenAiKeyFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim();
}

export async function createOpenAiResponse({
  apiKey,
  payload,
}: {
  apiKey: string;
  payload: Record<string, unknown>;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { ok: false as const, status: response.status, body: await response.text() };
  }

  const body = await response.json();
  return { ok: true as const, body };
}

export function extractOutputText(responseBody: unknown) {
  if (
    responseBody &&
    typeof responseBody === "object" &&
    "output_text" in responseBody &&
    typeof responseBody.output_text === "string"
  ) {
    return responseBody.output_text;
  }
  return null;
}
```

- [ ] **Step 4: Create map assistant route**

Create `app/api/ai/map-assistant/route.ts` using:

```ts
import { z } from "zod";
import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import { createOpenAiResponse, extractOutputText, getOpenAiKeyFromRequest } from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";

const requestSchema = z.object({
  message: z.string().min(1).max(4000),
  mapState: mapStateSchema,
  selectedZoneIds: z.array(z.string()).optional(),
  activeFilters: z.record(z.string(), z.unknown()).optional(),
});

const assistantResponseSchema = z.object({
  explanation: z.string(),
  intent: z.enum(["map_edit", "prioritization", "comparison", "listing_search", "unknown"]),
  proposal: mapPatchProposalSchema.nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  caveats: z.array(z.string()),
});

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);
  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = requestSchema.parse(await request.json());
    const model = process.env.OPENAI_MODEL ?? "gpt-5.5";
    const response = await createOpenAiResponse({
      apiKey,
      payload: {
        model,
        store: false,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content:
              "You help with an SF apartment-search map. Return only structured JSON. Never claim boundaries are official. Propose changes only; never say changes were applied.",
          },
          {
            role: "user",
            content: JSON.stringify(body),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "map_assistant_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["explanation", "intent", "proposal", "confidence", "caveats"],
              properties: {
                explanation: { type: "string" },
                intent: { type: "string", enum: ["map_edit", "prioritization", "comparison", "listing_search", "unknown"] },
                proposal: { type: ["object", "null"] },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                caveats: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    });

    if (!response.ok) {
      return Response.json({ ok: false, error: "OpenAI request failed." }, { status: response.status });
    }

    const outputText = extractOutputText(response.body);
    if (!outputText) {
      return Response.json({ ok: false, error: "OpenAI response was missing structured output." }, { status: 502 });
    }

    return Response.json(assistantResponseSchema.parse(JSON.parse(outputText)));
  } catch (error) {
    return Response.json(
      { ok: false, error: "Invalid map assistant request.", details: redactSecrets(error) },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 5: Create listing search route**

Create `app/api/ai/listing-search/route.ts`. It must:

- require `Authorization: Bearer <user-openai-key>`
- use `store: false`
- include `tools: [{ type: "web_search" }]`
- use `tool_choice: "required"`
- parse `ListingSearchResponse`
- mint `geocodeAuthorization` when candidates have `geocodeQuery`

Use this core structure:

```ts
import { z } from "zod";
import { listingSearchResponseSchema } from "@/lib/domain/schemas";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";
import { createOpenAiResponse, extractOutputText, getOpenAiKeyFromRequest } from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";

const requestSchema = z.object({
  query: z.string().min(1).max(4000),
  filters: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);
  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = requestSchema.parse(await request.json());
    const model = process.env.OPENAI_MODEL ?? "gpt-5.5";
    const response = await createOpenAiResponse({
      apiKey,
      payload: {
        model,
        store: false,
        reasoning: { effort: "medium" },
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: [
          {
            role: "system",
            content:
              "Find current SF apartment listing candidates. Return source-linked structured JSON only. Do not scrape directly. Preserve clickable source URLs and caveats.",
          },
          {
            role: "user",
            content: JSON.stringify(body),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "listing_search_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["candidates", "sourceSummary", "citations", "caveats", "geocodeAuthorization"],
              properties: {
                candidates: { type: "array", items: { type: "object" } },
                sourceSummary: { type: "string" },
                citations: { type: "array", items: { type: "object" } },
                caveats: { type: "array", items: { type: "string" } },
                geocodeAuthorization: { type: ["object", "null"] },
              },
            },
          },
        },
      },
    });

    if (!response.ok) {
      return Response.json({ ok: false, error: "OpenAI request failed." }, { status: response.status });
    }

    const outputText = extractOutputText(response.body);
    if (!outputText) {
      return Response.json({ ok: false, error: "OpenAI response was missing structured output." }, { status: 502 });
    }

    const parsed = listingSearchResponseSchema.parse(JSON.parse(outputText));
    const geocodeable = parsed.candidates
      .filter((candidate) => candidate.geocodeQuery)
      .slice(0, 10)
      .map((candidate) => ({
        candidateId: candidate.id,
        geocodeQuery: candidate.geocodeQuery as string,
      }));

    const geocodeAuthorization =
      geocodeable.length > 0 && process.env.GEOCODE_NONCE_SECRET
        ? createGeocodeAuthorization({
            secret: process.env.GEOCODE_NONCE_SECRET,
            candidates: geocodeable,
            maxAttempts: geocodeable.length,
            ttlSeconds: 10 * 60,
          })
        : null;

    return Response.json({ ...parsed, geocodeAuthorization });
  } catch (error) {
    return Response.json(
      { ok: false, error: "Invalid listing search request.", details: redactSecrets(error) },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 6: Run route tests**

```bash
npm run test -- tests/routes/map-assistant-route.test.ts tests/routes/listing-search-route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run verification**

```bash
npm run lint
npm run typecheck
npm run test
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/server/openai.ts app/api/ai/map-assistant/route.ts app/api/ai/listing-search/route.ts tests/routes/map-assistant-route.test.ts tests/routes/listing-search-route.test.ts
git commit -m "Add OpenAI assistant routes"
```

---

## Task 9: Build The App Shell And Sidebar

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Create: `components/apartment-map/apartment-map-app.tsx`
- Create: `components/apartment-map/sidebar.tsx`
- Create: `components/apartment-map/api-key-dialog.tsx`
- Create: `components/apartment-map/assistant-panel.tsx`
- Create: `components/apartment-map/listing-results.tsx`
- Create: `components/apartment-map/proposal-review-dialog.tsx`

- [ ] **Step 1: Replace the starter page**

Modify `app/page.tsx` to render the app shell:

```tsx
import { ApartmentMapApp } from "@/components/apartment-map/apartment-map-app";

export default function Home() {
  return <ApartmentMapApp />;
}
```

- [ ] **Step 2: Update metadata**

Modify `app/layout.tsx` metadata:

```ts
export const metadata: Metadata = {
  title: "SF Apartment Hunt",
  description: "Local-first SF apartment map with AI-assisted search.",
};
```

- [ ] **Step 3: Create top-level Client Component**

Create `components/apartment-map/apartment-map-app.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { applyProposal } from "@/lib/map/proposals";
import { loadMapState, saveMapState, clearMapState } from "@/lib/storage/map-storage";
import { Sidebar } from "@/components/apartment-map/sidebar";

const LeafletMap = dynamic(
  () => import("@/components/apartment-map/leaflet-map").then((module) => module.LeafletMap),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-sm">Loading map</div> },
);

export function ApartmentMapApp() {
  const initialState = useMemo(() => loadMapState() ?? seedMapState, []);
  const [mapState, setMapState] = useState<MapState>(initialState);
  const [history, setHistory] = useState<MapState[]>([]);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<MapPatchProposal | null>(null);
  const [listings, setListings] = useState<ListingCandidate[]>([]);

  function updateMapState(nextState: MapState) {
    setHistory((items) => [...items.slice(-19), mapState]);
    setMapState(nextState);
    saveMapState(nextState);
  }

  function undoLastEdit() {
    const previous = history.at(-1);
    if (!previous) {
      return;
    }
    setHistory((items) => items.slice(0, -1));
    setMapState(previous);
    saveMapState(previous);
  }

  function resetLocalMap() {
    setHistory((items) => [...items.slice(-19), mapState]);
    setMapState(seedMapState);
    clearMapState();
  }

  function applyCurrentProposal() {
    if (!proposal) {
      return;
    }
    const result = applyProposal(mapState, proposal);
    if (result.ok) {
      updateMapState(result.state);
      setProposal(null);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="relative min-h-[58vh] border-b border-border lg:min-h-screen lg:border-b-0 lg:border-r">
        <LeafletMap
          mapState={mapState}
          listings={listings}
          selectedZoneIds={selectedZoneIds}
          onMapStateChange={updateMapState}
          onSelectedZoneIdsChange={setSelectedZoneIds}
        />
        <div className="absolute bottom-3 left-3 max-w-[min(520px,calc(100%-24px))] border border-border bg-background/95 px-3 py-2 text-xs shadow-sm">
          Boundaries are approximate apartment-search zones, not official boundaries.
        </div>
      </section>
      <Sidebar
        mapState={mapState}
        selectedZoneIds={selectedZoneIds}
        listings={listings}
        proposal={proposal}
        onListingsChange={setListings}
        onProposalChange={setProposal}
        onApplyProposal={applyCurrentProposal}
        onRejectProposal={() => setProposal(null)}
        onUndo={undoLastEdit}
        onReset={resetLocalMap}
      />
    </main>
  );
}
```

- [ ] **Step 4: Create stub sidebar and child components**

Create `components/apartment-map/sidebar.tsx`:

```tsx
"use client";

import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { ApiKeyDialog } from "@/components/apartment-map/api-key-dialog";
import { AssistantPanel } from "@/components/apartment-map/assistant-panel";
import { ListingResults } from "@/components/apartment-map/listing-results";
import { ProposalReviewDialog } from "@/components/apartment-map/proposal-review-dialog";

export function Sidebar({
  mapState,
  selectedZoneIds,
  listings,
  proposal,
  onListingsChange,
  onProposalChange,
  onApplyProposal,
  onRejectProposal,
  onUndo,
  onReset,
}: {
  mapState: MapState;
  selectedZoneIds: string[];
  listings: ListingCandidate[];
  proposal: MapPatchProposal | null;
  onListingsChange: (listings: ListingCandidate[]) => void;
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onApplyProposal: () => void;
  onRejectProposal: () => void;
  onUndo: () => void;
  onReset: () => void;
}) {
  return (
    <aside className="flex max-h-screen min-h-screen flex-col overflow-y-auto bg-background">
      <div className="border-b border-border p-4">
        <h1 className="text-lg font-semibold">SF Apartment Hunt</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {mapState.zones.length} zones, {selectedZoneIds.length} selected
        </p>
      </div>
      <div className="flex gap-2 border-b border-border p-3">
        <Button variant="outline" onClick={onUndo}>Undo</Button>
        <Button variant="outline" onClick={onReset}>Reset</Button>
      </div>
      <div className="space-y-4 p-4">
        <ApiKeyDialog apiKey={null} remembered={false} onApiKeyChange={() => {}} />
        <AssistantPanel
          apiKey={null}
          mapState={mapState}
          selectedZoneIds={selectedZoneIds}
          onProposalChange={onProposalChange}
          onListingsChange={onListingsChange}
        />
        <ListingResults listings={listings} />
        <ProposalReviewDialog
          proposal={proposal}
          onApply={onApplyProposal}
          onReject={onRejectProposal}
        />
      </div>
    </aside>
  );
}
```

Create `components/apartment-map/api-key-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function ApiKeyDialog({
  apiKey,
  remembered,
}: {
  apiKey: string | null;
  remembered: boolean;
  onApiKeyChange: (key: string | null, remembered: boolean) => void;
}) {
  return (
    <div className="border border-border p-3 text-sm">
      <div className="font-medium">{apiKey ? "OpenAI key saved" : "OpenAI key required"}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {remembered ? "Remembered on this device" : "Stored for this session"}
      </div>
      <Button className="mt-3" variant="outline">Add OpenAI key</Button>
    </div>
  );
}
```

Create `components/apartment-map/assistant-panel.tsx`:

```tsx
"use client";

import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

export function AssistantPanel({
  apiKey,
  mapState,
  selectedZoneIds,
}: {
  apiKey: string | null;
  mapState: MapState;
  selectedZoneIds: string[];
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onListingsChange: (listings: ListingCandidate[]) => void;
}) {
  return (
    <div className="border border-border p-3 text-sm">
      <label className="text-xs font-medium" htmlFor="assistant-message">Ask the assistant</label>
      <textarea
        id="assistant-message"
        className="mt-2 min-h-24 w-full border border-input bg-background p-2 text-sm"
        disabled={!apiKey}
        placeholder={apiKey ? "Find studio/1BR under $3k near Lower Pac Heights" : "OpenAI key required"}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{mapState.zones.length} zones available; {selectedZoneIds.length} selected</span>
        <Button disabled={!apiKey}>Send</Button>
      </div>
    </div>
  );
}
```

Create `components/apartment-map/listing-results.tsx`:

```tsx
"use client";

import type { ListingCandidate } from "@/lib/domain/types";

export function ListingResults({ listings }: { listings: ListingCandidate[] }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">Listings</div>
      {listings.length === 0 ? (
        <p className="text-muted-foreground">No listing candidates yet.</p>
      ) : (
        listings.map((listing) => (
          <article key={listing.id} className="border border-border p-3">
            <a className="font-medium underline" href={listing.url} target="_blank" rel="noreferrer">
              {listing.title}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">{listing.whyItFits}</p>
          </article>
        ))
      )}
    </div>
  );
}
```

Create `components/apartment-map/proposal-review-dialog.tsx`:

```tsx
"use client";

import type { MapPatchProposal } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

export function ProposalReviewDialog({
  proposal,
  onApply,
  onReject,
}: {
  proposal: MapPatchProposal | null;
  onApply: () => void;
  onReject: () => void;
}) {
  if (!proposal) {
    return null;
  }
  return (
    <div className="border border-border p-3">
      <p className="text-sm">{proposal.summary}</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={onApply}>Apply changes</Button>
        <Button variant="outline" onClick={onReject}>Reject</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run verification**

```bash
npm run lint
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/layout.tsx components/apartment-map
git commit -m "Add apartment map app shell"
```

---

## Task 10: Add Leaflet Map Rendering And Manual Editing

**Files:**
- Create: `components/apartment-map/leaflet-map.tsx`
- Modify: `app/globals.css`
- Create: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Add Leaflet CSS imports**

Add these near the top of `app/globals.css`:

```css
@import "leaflet/dist/leaflet.css";
@import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
```

- [ ] **Step 2: Create Leaflet map component**

Create `components/apartment-map/leaflet-map.tsx`:

```tsx
"use client";

import "@geoman-io/leaflet-geoman-free";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { ListingCandidate, MapState } from "@/lib/domain/types";

const SF_CENTER: [number, number] = [37.778, -122.431];

function toLeafletLatLng(coordinate: number[]): [number, number] {
  return [coordinate[1], coordinate[0]];
}

function EditableLayerControls({
  enabled,
  onEdited,
}: {
  enabled: boolean;
  onEdited: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    map.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawRectangle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    });
    map.pm.setGlobalOptions({ allowSelfIntersection: false });
    map.on("pm:edit", onEdited);
    return () => {
      map.off("pm:edit", onEdited);
      map.pm.removeControls();
    };
  }, [map, onEdited]);

  useEffect(() => {
    if (enabled) {
      map.pm.enableGlobalEditMode();
    } else {
      map.pm.disableGlobalEditMode();
    }
  }, [enabled, map]);

  return null;
}

export function LeafletMap({
  mapState,
  listings,
  selectedZoneIds,
  onMapStateChange,
  onSelectedZoneIdsChange,
}: {
  mapState: MapState;
  listings: ListingCandidate[];
  selectedZoneIds: string[];
  onMapStateChange: (state: MapState) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
}) {
  const editRevision = useRef(0);
  const tileUrl = process.env.NEXT_PUBLIC_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution =
    process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const selectedSet = useMemo(() => new Set(selectedZoneIds), [selectedZoneIds]);

  return (
    <MapContainer center={SF_CENTER} zoom={13} className="h-full min-h-[58vh] w-full lg:min-h-screen">
      <TileLayer url={tileUrl} attribution={tileAttribution} />
      <EditableLayerControls
        enabled
        onEdited={() => {
          editRevision.current += 1;
          onMapStateChange(mapState);
        }}
      />
      {mapState.zones.map((zone) => (
        <Polygon
          key={zone.id}
          pathOptions={{
            color: selectedSet.has(zone.id) ? "#0f766e" : "#2563eb",
            fillOpacity: selectedSet.has(zone.id) ? 0.24 : 0.12,
            weight: selectedSet.has(zone.id) ? 3 : 2,
          }}
          positions={zone.geometry.coordinates[0].map(toLeafletLatLng)}
          eventHandlers={{
            click: () => {
              onSelectedZoneIdsChange(
                selectedSet.has(zone.id)
                  ? selectedZoneIds.filter((id) => id !== zone.id)
                  : [...selectedZoneIds, zone.id],
              );
            },
          }}
        >
          <Popup>{zone.name}</Popup>
        </Polygon>
      ))}
      {mapState.corridors.map((corridor) => (
        <Polyline
          key={corridor.id}
          pathOptions={{ color: corridor.priority === "high" ? "#dc2626" : "#525252", weight: 4 }}
          positions={corridor.geometry.coordinates.map(toLeafletLatLng)}
        >
          <Popup>{corridor.name}</Popup>
        </Polyline>
      ))}
      {mapState.targets.map((target) => (
        <Marker key={target.id} position={toLeafletLatLng(target.coordinates)}>
          <Popup>{target.name}</Popup>
        </Marker>
      ))}
      {listings
        .filter((listing) => listing.coordinates)
        .map((listing) => (
          <Marker key={listing.id} position={toLeafletLatLng(listing.coordinates as [number, number])}>
            <Popup>
              {listing.title}
              <br />
              {listing.markerPrecision === "approximate" ? "Approximate location" : "Exact location"}
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}
```

- [ ] **Step 3: Add a browser smoke test**

Create `tests/e2e/apartment-map.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://*.tile.openstreetmap.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });
});

test("renders the app and base map note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SF Apartment Hunt")).toBeVisible();
  await expect(page.getByText("Boundaries are approximate apartment-search zones, not official boundaries.")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
});
```

- [ ] **Step 4: Run browser test**

If Playwright browser binaries are not installed, run:

```bash
npx playwright install chromium
```

Then run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css components/apartment-map/leaflet-map.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Render editable apartment map"
```

---

## Task 11: Wire API Key, Assistant, Proposal Review, Listings, And Geocoding UI

**Files:**
- Modify: `components/apartment-map/api-key-dialog.tsx`
- Modify: `components/apartment-map/assistant-panel.tsx`
- Modify: `components/apartment-map/listing-results.tsx`
- Modify: `components/apartment-map/proposal-review-dialog.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Add API-key dialog behavior**

`components/apartment-map/api-key-dialog.tsx` must:

- show whether a key is available
- default to session storage
- include "remember on this device" checkbox
- call `saveOpenAiKey` and `clearStoredOpenAiKey`
- never print the key after save

Use this public prop shape:

```ts
type ApiKeyDialogProps = {
  apiKey: string | null;
  remembered: boolean;
  onApiKeyChange: (key: string | null, remembered: boolean) => void;
};
```

- [ ] **Step 2: Add assistant behavior**

`components/apartment-map/assistant-panel.tsx` must:

- keep one text area for natural-language commands
- keep controls for budget, beds, timing, short-term, furnished
- disable real submit when no OpenAI key is available
- send `Authorization: Bearer ${apiKey}` to `/api/ai/map-assistant` or `/api/ai/listing-search`
- treat listing-like prompts as listing search when prompt contains `listing`, `studio`, `1br`, `1 bedroom`, `under`, `rent`, or `available`
- render errors without dumping raw response bodies

Use this public prop shape:

```ts
type AssistantPanelProps = {
  apiKey: string | null;
  mapState: MapState;
  selectedZoneIds: string[];
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onListingsChange: (listings: ListingCandidate[]) => void;
};
```

- [ ] **Step 3: Add proposal review dialog**

`components/apartment-map/proposal-review-dialog.tsx` must:

- render operation list
- show Apply changes, Reject, Copy proposal JSON
- call `/api/map/apply-proposal` before applying client-side state
- never apply automatically when a proposal arrives

- [ ] **Step 4: Add listing cards**

`components/apartment-map/listing-results.tsx` must render:

- title
- price
- source domain
- neighborhood guess
- fit score
- `whyItFits`
- caveats
- visible clickable citations
- approximate/exact pin status when coordinates exist

- [ ] **Step 5: Add geocoding after listing search**

After a listing response arrives:

- store candidates in state immediately
- when `geocodeAuthorization` exists, geocode at most `maxAttempts` candidates with `geocodeQuery`
- skip candidates already present in local geocode cache
- send `nonce`, `candidateId`, and `geocodeQuery` to `/api/geocode/listing`
- update listing coordinates only on successful geocode responses
- cache successful and failed geocode responses by canonical query

- [ ] **Step 6: Add E2E coverage**

Extend `tests/e2e/apartment-map.spec.ts` with:

```ts
test("shows disabled AI state until a key is saved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("OpenAI key required")).toBeVisible();
});

test("shows proposal review before applying AI changes", async ({ page }) => {
  await page.route("/api/ai/map-assistant", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        explanation: "I can raise Valencia priority.",
        intent: "prioritization",
        proposal: {
          summary: "Raise Valencia priority.",
          operations: [
            {
              type: "updateCorridorPriority",
              corridorId: "valencia",
              priority: "high",
              reason: "Best fitness fit.",
            },
          ],
          confidence: "high",
          requiresUserReview: true,
        },
        confidence: "high",
        caveats: [],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Add OpenAI key" }).click();
  await page.getByLabel("OpenAI API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByLabel("Ask the assistant").fill("Make Valencia target corridor more important");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Raise Valencia priority.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply changes" })).toBeVisible();
});
```

- [ ] **Step 7: Run verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add components/apartment-map tests/e2e/apartment-map.spec.ts
git commit -m "Wire assistant and listing UI"
```

---

## Task 12: Update README And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace starter README**

Update `README.md` with these sections:

```md
# SF Apartment Hunt

Interactive SF apartment-search map with local map edits, BYO OpenAI assistant calls, sourced listing research, and protected Google geocoding.

## Local Development

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:3333.

## Environment Variables

Required for listing geocoding in production:

- \`GOOGLE_MAPS_API_KEY\`: server-only Google Geocoding API key restricted to the Geocoding API.
- \`GEOCODE_NONCE_SECRET\`: server-only signing secret for short-lived geocoding nonces.
- \`UPSTASH_REDIS_REST_URL\`: Redis-compatible rate-limit store URL.
- \`UPSTASH_REDIS_REST_TOKEN\`: Redis-compatible rate-limit store token.

Optional:

- \`OPENAI_MODEL\`: defaults to \`gpt-5.5\`.
- \`NEXT_PUBLIC_TILE_URL\`: OSM-compatible tile URL.
- \`NEXT_PUBLIC_TILE_ATTRIBUTION\`: attribution for the configured tile source.

## OpenAI Key Behavior

The public app does not use a server-owned OpenAI key. Each visitor provides their own key in the UI. The key is stored in session storage by default. The "remember on this device" option stores it in local storage on that browser only. The server receives the key per request and does not store, log, or echo it.

## Google Geocoding Guardrails

Google Geocoding uses the server-owned \`GOOGLE_MAPS_API_KEY\`. The geocoding route accepts only candidate/query pairs signed by a recent listing search nonce, rejects non-SF results, and requires a Redis-compatible rate-limit store in production.

Set Google Cloud restrictions:

- Restrict the key to the Geocoding API.
- Set daily quota limits.
- Monitor usage alerts.

## Map Tiles

The default base map uses OpenStreetMap-compatible tiles with visible attribution. Do not prefetch, bulk download, or cache tiles offline. For higher public traffic, configure a paid tile provider with \`NEXT_PUBLIC_TILE_URL\` and \`NEXT_PUBLIC_TILE_ATTRIBUTION\`.

## Listing Search Policy

Listing search uses OpenAI hosted web search and source links. The app does not scrape Zillow, Craigslist, Apartments.com, or listing sites directly. Users must click through to verify price, availability, terms, and location.

## Verification

\`\`\`bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
\`\`\`
```

- [ ] **Step 2: Run final verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Manual acceptance**

Run `npm run dev`, open `http://localhost:3333`, and verify:

- Map renders all seed zones.
- The approximate-boundary note is visible.
- Layer toggles and zone selection work.
- Manual edit mode can move geometry and undo/reset restore state.
- With no OpenAI key, assistant/listing controls show disabled state.
- With a test key and mocked routes, AI proposal appears but does not apply until confirmation.
- Listing cards show source links, citations, `whyItFits`, caveats, and pin status.
- Refresh preserves local map edits.
- Clearing local data restores seed map.

- [ ] **Step 4: Commit README and final fixes**

```bash
git add README.md
git commit -m "Document apartment map setup"
```

If final verification required small code fixes, stage those exact files in the same commit only when they directly support README-described behavior.

---

## Self-Review Checklist

- Spec coverage:
  - Domain contracts: Tasks 2 and 3.
  - Local map data and proposal application: Task 3.
  - Local storage and BYO OpenAI key handling: Task 4 and Task 11.
  - Google geocoding nonce, rate limits, and SF bounds: Tasks 5 and 7.
  - OpenAI map/listing routes: Task 8.
  - Leaflet map and manual editing: Task 10.
  - Sidebar, assistant, proposal review, listing results: Tasks 9 and 11.
  - README/deployment caveats: Task 12.
- Placeholder scan: no task should contain incomplete requirements.
- Type consistency: use `ListingCandidate.whyItFits`, `ListingSearchResponse.geocodeAuthorization`, `[longitude, latitude]` storage coordinates, and `MapPatchProposal.requiresUserReview: true` consistently.
- Verification: every task ends with focused tests, lint, typecheck, and a commit.
