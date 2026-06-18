# Researched Map Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the map assistant return sourced, reviewable pins and corridors from web research, with server-side geocoding, quota protection, duplicate filtering, and conversational follow-up outcomes.

**Architecture:** Keep the persisted mutation contract as `MapPatchProposal`; researched metadata is a review-only companion object. The OpenAI route receives raw model outcomes, enriches researched candidates through deterministic server helpers, and returns a validated `MapAssistantOutcome` to the client. Geocoding, official geometry resolution, dedupe, bounds checks, and research-summary correlation happen outside the model.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, TypeScript, Zod, OpenAI Responses hosted `web_search`, Google Geocoding, Upstash Redis fixed-window limits, Vitest, Playwright, Tailwind CSS 4.

---

## File Structure

Read the relevant Next.js 16 docs before editing route or client files:

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
sed -n '1,180p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
sed -n '1,180p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Create these files:

- `lib/map/research-summary.ts`: validates `ResearchSummary` correlation against final proposal operations.
- `lib/map/researched-map-proposals.ts`: pure candidate normalization, dedupe, bounds validation, and conversion into proposal operations plus summary metadata.
- `lib/server/map-research-geocode.ts`: server-side researched-geocode caps, IP/session fixed-window rate limiting, and Google Geocoding calls.
- `lib/server/research-geometry-source.ts`: deterministic official geometry resolver for cited GeoJSON LineString sources.
- `lib/storage/geocode-session-storage.ts`: client storage wrapper for the shared `sf-apt-hunt:geocode-session:v1` session id.
- `tests/unit/research-summary.test.ts`: schema/correlation tests for review metadata.
- `tests/unit/researched-map-proposals.test.ts`: pure conversion, dedupe, cap, bounds, and geometry-quality tests.
- `tests/unit/map-research-geocode.test.ts`: quota and fail-closed geocoding tests.

Modify these files:

- `lib/domain/types.ts`: add `MapAssistantOutcome`, `ResearchSummary`, researched candidate types, and geometry-quality unions.
- `lib/domain/schemas.ts`: add Zod schemas for researched outcomes and export constants needed by route tests.
- `app/api/ai/map-assistant/route.ts`: expose web search to OpenAI, parse raw assistant outcomes, enrich researched candidates, and return validated public outcomes.
- `components/apartment-map/apartment-map-app.tsx`: store proposal review state as proposal plus optional `researchSummary`; use the shared geocode-session storage helper.
- `components/apartment-map/sidebar.tsx`: pass proposal review state through to the dialog.
- `components/apartment-map/assistant-panel.tsx`: parse `MapAssistantOutcome`, keep pending clarification context, send `x-sf-apt-session`, and display successful `needsMoreInfo`/`noAction` messages.
- `components/apartment-map/proposal-review-dialog.tsx`: render research source, confidence, geometry quality, caveats, and exclusions.
- `tests/routes/map-assistant-route.test.ts`: route tests for researched outcomes, geocoding, quotas, strict schemas, redaction, and correlation.
- `tests/e2e/apartment-map.spec.ts`: end-to-end coverage for sourced pins, bus corridor review metadata, follow-up prompts, and `noAction` display.

Do not modify `/api/map/apply-proposal`; researched metadata is not part of persisted map state and should not be required by apply.

## Contract Definitions

Add these public types in `lib/domain/types.ts`:

```ts
export type ResearchConfidence = "high" | "medium" | "low";

export type CorridorGeometryQuality = "official" | "fromStops" | "approximate";

export type ResearchExclusionReason =
  | "duplicate"
  | "out_of_bounds"
  | "geocode_failed"
  | "missing_source"
  | "invalid_geometry"
  | "over_cap";

export type ResearchSummary = {
  items: ResearchSummaryItem[];
  exclusions: ResearchExclusion[];
  caveats: string[];
};

export type ResearchSummaryItem = {
  entityId: string;
  operationType: "addTarget" | "addCorridor";
  label: string;
  source: SourceCitation;
  confidence: ResearchConfidence;
  geometryQuality?: CorridorGeometryQuality;
  geocodePrecision?: "exact" | "approximate";
  caveats: string[];
};

export type ResearchExclusion = {
  label: string;
  reason: ResearchExclusionReason;
  source?: SourceCitation;
  caveats: string[];
};

export type MapAssistantOutcome =
  | {
      kind: "needsMoreInfo";
      assistantMessage: string;
      missingInformation: string[];
    }
  | {
      kind: "proposal";
      assistantMessage: string;
      proposal: MapPatchProposal;
      researchSummary: ResearchSummary;
    }
  | {
      kind: "noAction";
      assistantMessage: string;
      caveats: string[];
    };

export type ResearchTargetCandidate = {
  id: string;
  name: string;
  address: string | null;
  geocodeQuery: string;
  source: SourceCitation | null;
  purpose: string;
  influence: TargetInfluence;
  priority: Priority;
  radiusMinutes: TargetRadiusMinutes;
  notes: string[];
  confidence: ResearchConfidence;
  caveats: string[];
  modelCoordinates: Coordinate | null;
};

export type ResearchCorridorWaypoint = {
  label: string;
  geocodeQuery: string | null;
  coordinates: Coordinate | null;
};

export type ResearchCorridorCandidate = {
  id: string;
  name: string;
  source: SourceCitation | null;
  priority: Priority;
  tags: TargetCorridor["tags"];
  notes: string[];
  confidence: ResearchConfidence;
  requestedGeometryQuality: CorridorGeometryQuality;
  officialGeometryUrl: string | null;
  sourcedLineString: LineStringGeometry | null;
  orderedWaypoints: ResearchCorridorWaypoint[];
  routeDescription: string | null;
  caveats: string[];
};
```

The raw model output is route-internal. Keep it separate from `MapAssistantOutcome` so the model can return candidates while the server returns a final proposal:

```ts
type MapAssistantModelOutput =
  | {
      kind: "needsMoreInfo";
      assistantMessage: string;
      missingInformation: string[];
    }
  | {
      kind: "noAction";
      assistantMessage: string;
      caveats: string[];
    }
  | {
      kind: "proposal";
      assistantMessage: string;
      proposal: MapPatchProposal;
      researchSummary: ResearchSummary;
    }
  | {
      kind: "research";
      assistantMessage: string;
      targetCandidates: ResearchTargetCandidate[];
      corridorCandidates: ResearchCorridorCandidate[];
      caveats: string[];
    };
```

## Task 1: Domain Schemas And Summary Correlation

**Files:**
- Modify: `lib/domain/types.ts`
- Modify: `lib/domain/schemas.ts`
- Create: `lib/map/research-summary.ts`
- Test: `tests/unit/research-summary.test.ts`

- [ ] **Step 1: Write failing tests for public outcome parsing and summary correlation**

Add `tests/unit/research-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { mapAssistantOutcomeSchema } from "@/lib/domain/schemas";
import { validateResearchSummaryCorrelation } from "@/lib/map/research-summary";
import type { MapPatchProposal, ResearchSummary } from "@/lib/domain/types";

const targetProposal: MapPatchProposal = {
  summary: "Add researched gym target.",
  operations: [
    {
      type: "addTarget",
      target: {
        id: "orange-theory-fi-di",
        name: "Orangetheory Fitness Financial District",
        purpose: "fitness anchor",
        coordinates: [-122.401, 37.792],
        priority: "high",
        influence: "positive",
        radiusMinutes: 10,
        notes: ["Researched location."],
      },
    },
  ],
  confidence: "high",
  requiresUserReview: true,
};

const matchingSummary: ResearchSummary = {
  items: [
    {
      entityId: "orange-theory-fi-di",
      operationType: "addTarget",
      label: "Orangetheory Fitness Financial District",
      source: {
        url: "https://www.orangetheory.com/en-us/locations/california/san-francisco/financial-district",
        title: "Orangetheory Financial District",
        sourceDomain: "orangetheory.com",
      },
      confidence: "high",
      geocodePrecision: "exact",
      caveats: [],
    },
  ],
  exclusions: [],
  caveats: [],
};

describe("mapAssistantOutcomeSchema", () => {
  it("parses needsMoreInfo without requiring a proposal", () => {
    expect(
      mapAssistantOutcomeSchema.parse({
        kind: "needsMoreInfo",
        assistantMessage: "Which route or place type should I map?",
        missingInformation: ["what to find", "where to search"],
      }),
    ).toEqual({
      kind: "needsMoreInfo",
      assistantMessage: "Which route or place type should I map?",
      missingInformation: ["what to find", "where to search"],
    });
  });

  it("parses noAction as a successful assistant outcome", () => {
    expect(
      mapAssistantOutcomeSchema.parse({
        kind: "noAction",
        assistantMessage: "I could not find a sourced SF result for that request.",
        caveats: ["No matching source was found."],
      }),
    ).toEqual({
      kind: "noAction",
      assistantMessage: "I could not find a sourced SF result for that request.",
      caveats: ["No matching source was found."],
    });
  });

  it("parses a proposal outcome with matching research metadata", () => {
    expect(
      mapAssistantOutcomeSchema.parse({
        kind: "proposal",
        assistantMessage: "I found one researched target for review.",
        proposal: targetProposal,
        researchSummary: matchingSummary,
      }),
    ).toMatchObject({
      kind: "proposal",
      proposal: targetProposal,
      researchSummary: matchingSummary,
    });
  });

  it("rejects proposal outcomes when an addTarget operation has no summary item", () => {
    expect(() =>
      mapAssistantOutcomeSchema.parse({
        kind: "proposal",
        assistantMessage: "I found one researched target for review.",
        proposal: targetProposal,
        researchSummary: { items: [], exclusions: [], caveats: [] },
      }),
    ).toThrow(/research summary/i);
  });

  it("rejects proposal outcomes when a summary item has no matching operation", () => {
    expect(() =>
      mapAssistantOutcomeSchema.parse({
        kind: "proposal",
        assistantMessage: "I found one researched target for review.",
        proposal: targetProposal,
        researchSummary: {
          ...matchingSummary,
          items: [
            {
              ...matchingSummary.items[0],
              entityId: "not-in-proposal",
            },
          ],
        },
      }),
    ).toThrow(/research summary/i);
  });
});

describe("validateResearchSummaryCorrelation", () => {
  it("accepts empty summary items for non-researched operations", () => {
    const proposal: MapPatchProposal = {
      summary: "Add a note.",
      operations: [
        {
          type: "addNote",
          entityId: "lower-pac-heights",
          note: "Look near Fillmore.",
        },
      ],
      confidence: "medium",
      requiresUserReview: true,
    };

    expect(
      validateResearchSummaryCorrelation({
        proposal,
        researchSummary: { items: [], exclusions: [], caveats: [] },
      }),
    ).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the focused test to confirm it fails**

Run:

```bash
npm run test -- tests/unit/research-summary.test.ts
```

Expected: FAIL because `mapAssistantOutcomeSchema` and `validateResearchSummaryCorrelation` do not exist.

- [ ] **Step 3: Add researched types**

Update `lib/domain/types.ts` with the declarations from the "Contract Definitions" section. Place them after `SourceCitation` and before listing-specific types so shared map assistant contracts stay near the shared citation type.

- [ ] **Step 4: Add research summary correlation helper**

Create `lib/map/research-summary.ts`:

```ts
import type { MapPatchProposal, ResearchSummary } from "@/lib/domain/types";

export type ResearchSummaryCorrelationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateResearchSummaryCorrelation({
  proposal,
  researchSummary,
}: {
  proposal: MapPatchProposal;
  researchSummary: ResearchSummary;
}): ResearchSummaryCorrelationResult {
  const researchedOperations = proposal.operations.flatMap((operation) => {
    if (operation.type === "addTarget") {
      return [{ entityId: operation.target.id, operationType: "addTarget" as const }];
    }

    if (operation.type === "addCorridor") {
      return [{ entityId: operation.corridor.id, operationType: "addCorridor" as const }];
    }

    return [];
  });
  const expectedKeys = new Set(
    researchedOperations.map((operation) => `${operation.operationType}:${operation.entityId}`),
  );
  const actualKeys = new Set(
    researchSummary.items.map((item) => `${item.operationType}:${item.entityId}`),
  );

  for (const expectedKey of expectedKeys) {
    if (!actualKeys.has(expectedKey)) {
      return {
        ok: false,
        error: "Research summary is missing metadata for a proposed researched operation.",
      };
    }
  }

  for (const actualKey of actualKeys) {
    if (!expectedKeys.has(actualKey)) {
      return {
        ok: false,
        error: "Research summary references an operation that is not in the proposal.",
      };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 5: Add Zod schemas for research contracts**

Update `lib/domain/schemas.ts`:

```ts
import type {
  CorridorGeometryQuality,
  GeocodeAuthorization,
  LineStringGeometry,
  ListingCandidate,
  ListingLead,
  ListingSearchResponse,
  MapAssistantOutcome,
  MapPatchProposal,
  MapState,
  MapZone,
  PolygonGeometry,
  ResearchCorridorCandidate,
  ResearchCorridorWaypoint,
  ResearchExclusion,
  ResearchSummary,
  ResearchSummaryItem,
  ResearchTargetCandidate,
  SourceCitation,
  TargetCorridor,
  TargetPoint,
} from "@/lib/domain/types";
import { validateResearchSummaryCorrelation } from "@/lib/map/research-summary";
```

Add schemas near `sourceCitationSchema`:

```ts
const confidenceSchema = z.enum(["low", "medium", "high"]);
const corridorGeometryQualitySchema: z.ZodType<CorridorGeometryQuality> = z.enum([
  "official",
  "fromStops",
  "approximate",
]);

export const researchSummaryItemSchema: z.ZodType<ResearchSummaryItem> = z.object({
  entityId: idSchema,
  operationType: z.enum(["addTarget", "addCorridor"]),
  label: nameSchema,
  source: sourceCitationSchema,
  confidence: confidenceSchema,
  geometryQuality: corridorGeometryQualitySchema.optional(),
  geocodePrecision: z.enum(["exact", "approximate"]).optional(),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});

export const researchExclusionSchema: z.ZodType<ResearchExclusion> = z.object({
  label: nameSchema,
  reason: z.enum([
    "duplicate",
    "out_of_bounds",
    "geocode_failed",
    "missing_source",
    "invalid_geometry",
    "over_cap",
  ]),
  source: sourceCitationSchema.optional(),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});

export const researchSummarySchema: z.ZodType<ResearchSummary> = z.object({
  items: z.array(researchSummaryItemSchema).max(MAX_PROPOSAL_OPERATIONS),
  exclusions: z.array(researchExclusionSchema).max(100),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});

export const researchTargetCandidateSchema: z.ZodType<ResearchTargetCandidate> = z.object({
  id: idSchema,
  name: nameSchema,
  address: requiredTextSchema.nullable(),
  geocodeQuery: requiredTextSchema,
  source: sourceCitationSchema.nullable(),
  purpose: requiredTextSchema,
  influence: targetInfluenceSchema,
  priority: prioritySchema,
  radiusMinutes: targetRadiusMinutesSchema,
  notes: notesSchema,
  confidence: confidenceSchema,
  caveats: z.array(textSchema).max(MAX_CAVEATS),
  modelCoordinates: coordinateSchema.nullable(),
});

export const researchCorridorWaypointSchema: z.ZodType<ResearchCorridorWaypoint> = z.object({
  label: nameSchema,
  geocodeQuery: requiredTextSchema.nullable(),
  coordinates: coordinateSchema.nullable(),
});

export const researchCorridorCandidateSchema: z.ZodType<ResearchCorridorCandidate> = z.object({
  id: idSchema,
  name: nameSchema,
  source: sourceCitationSchema.nullable(),
  priority: prioritySchema,
  tags: z.array(z.enum(["fitness", "rent", "transit", "safety", "short-term"])).max(MAX_TAGS),
  notes: notesSchema,
  confidence: confidenceSchema,
  requestedGeometryQuality: corridorGeometryQualitySchema,
  officialGeometryUrl: urlSchema.nullable(),
  sourcedLineString: lineStringGeometrySchema.nullable(),
  orderedWaypoints: z.array(researchCorridorWaypointSchema).max(25),
  routeDescription: requiredLongTextSchema.nullable(),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});
```

Add the public outcome schema after `mapPatchProposalSchema`:

```ts
export const mapAssistantOutcomeSchema: z.ZodType<MapAssistantOutcome> = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("needsMoreInfo"),
      assistantMessage: requiredLongTextSchema,
      missingInformation: z.array(requiredTextSchema).min(1).max(20),
    }),
    z.object({
      kind: z.literal("proposal"),
      assistantMessage: requiredLongTextSchema,
      proposal: mapPatchProposalSchema,
      researchSummary: researchSummarySchema,
    }),
    z.object({
      kind: z.literal("noAction"),
      assistantMessage: requiredLongTextSchema,
      caveats: z.array(textSchema).max(MAX_CAVEATS),
    }),
  ])
  .superRefine((outcome, context) => {
    if (outcome.kind !== "proposal") {
      return;
    }

    const correlation = validateResearchSummaryCorrelation({
      proposal: outcome.proposal,
      researchSummary: outcome.researchSummary,
    });

    if (!correlation.ok) {
      context.addIssue({
        code: "custom",
        path: ["researchSummary", "items"],
        message: correlation.error,
      });
    }
  });
```

Replace repeated `z.enum(["low", "medium", "high"])` usages in listing, proposal, and route-adjacent schemas with `confidenceSchema` only when the replacement is local and behavior-preserving.

- [ ] **Step 6: Run the focused test**

Run:

```bash
npm run test -- tests/unit/research-summary.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git status --short
git add lib/domain/types.ts lib/domain/schemas.ts lib/map/research-summary.ts tests/unit/research-summary.test.ts
git commit -m "Add researched map assistant contracts"
```

Expected: one commit containing only the Task 1 files.

## Task 2: Pure Researched Proposal Builder

**Files:**
- Create: `lib/map/researched-map-proposals.ts`
- Test: `tests/unit/researched-map-proposals.test.ts`

- [ ] **Step 1: Write failing pure-unit tests**

Add `tests/unit/researched-map-proposals.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildResearchedMapProposal,
  canonicalizeResearchSourceUrl,
  normalizeResearchText,
} from "@/lib/map/researched-map-proposals";
import { seedMapState } from "@/lib/map/seed-data";
import type {
  Coordinate,
  LineStringGeometry,
  ResearchCorridorCandidate,
  ResearchTargetCandidate,
} from "@/lib/domain/types";

const source = {
  url: "https://www.orangetheory.com/en-us/locations/california/san-francisco/financial-district?utm_source=test",
  title: "Orangetheory Financial District",
  sourceDomain: "orangetheory.com",
};

function targetCandidate(overrides: Partial<ResearchTargetCandidate> = {}): ResearchTargetCandidate {
  return {
    id: "otf-fi-di",
    name: "Orangetheory Fitness Financial District",
    address: "120 Pine St, San Francisco, CA",
    geocodeQuery: "120 Pine St, San Francisco, CA",
    source,
    purpose: "fitness anchor",
    influence: "positive",
    priority: "high",
    radiusMinutes: 10,
    notes: ["Source-backed studio location."],
    confidence: "high",
    caveats: [],
    modelCoordinates: [-73.985, 40.758],
    ...overrides,
  };
}

function corridorCandidate(
  overrides: Partial<ResearchCorridorCandidate> = {},
): ResearchCorridorCandidate {
  return {
    id: "muni-1-california",
    name: "Muni 1 California",
    source: {
      url: "https://www.sfmta.com/routes/1-california",
      title: "1 California",
      sourceDomain: "sfmta.com",
    },
    priority: "high",
    tags: ["transit"],
    notes: ["Planning corridor from researched route evidence."],
    confidence: "medium",
    requestedGeometryQuality: "fromStops",
    officialGeometryUrl: null,
    sourcedLineString: null,
    orderedWaypoints: [
      { label: "California St & 6th Ave", geocodeQuery: null, coordinates: [-122.464, 37.785] },
      { label: "California St & Van Ness", geocodeQuery: null, coordinates: [-122.421, 37.79] },
      { label: "Drumm St & Clay St", geocodeQuery: null, coordinates: [-122.397, 37.795] },
    ],
    routeDescription: null,
    caveats: [],
    ...overrides,
  };
}

describe("research text normalization", () => {
  it("normalizes names and canonical source URLs for duplicate checks", () => {
    expect(normalizeResearchText("  Orangetheory  Fitness - FiDi! ")).toBe(
      "orangetheory fitness fidi",
    );
    expect(canonicalizeResearchSourceUrl(source.url)).toBe(
      "https://www.orangetheory.com/en-us/locations/california/san-francisco/financial-district",
    );
  });
});

describe("buildResearchedMapProposal", () => {
  it("converts geocoded target candidates into addTarget operations and ignores model coordinates", () => {
    const result = buildResearchedMapProposal({
      mapState: seedMapState,
      targetCandidates: [
        {
          candidate: targetCandidate(),
          geocode: {
            status: "ok",
            coordinates: [-122.401, 37.792],
            markerPrecision: "exact",
            formattedAddress: "120 Pine St, San Francisco, CA",
          },
        },
      ],
      corridorCandidates: [],
      caveats: [],
    });

    expect(result.outcome.kind).toBe("proposal");
    if (result.outcome.kind !== "proposal") {
      throw new Error("Expected proposal outcome.");
    }

    expect(result.outcome.proposal.operations).toEqual([
      {
        type: "addTarget",
        target: {
          id: "otf-fi-di",
          name: "Orangetheory Fitness Financial District",
          purpose: "fitness anchor",
          coordinates: [-122.401, 37.792],
          priority: "high",
          influence: "positive",
          radiusMinutes: 10,
          notes: ["Source-backed studio location."],
        },
      },
    ]);
    expect(result.outcome.researchSummary.items[0]).toMatchObject({
      entityId: "otf-fi-di",
      operationType: "addTarget",
      confidence: "high",
      geocodePrecision: "exact",
    });
  });

  it("excludes missing-source, duplicate, failed-geocode, and out-of-bounds target candidates", () => {
    const result = buildResearchedMapProposal({
      mapState: {
        ...seedMapState,
        targets: [
          ...seedMapState.targets,
          {
            id: "existing-otf",
            name: "Orangetheory Fitness Financial District",
            purpose: "fitness anchor",
            coordinates: [-122.401, 37.792],
            priority: "high",
            influence: "positive",
            radiusMinutes: 10,
            notes: [],
          },
        ],
      },
      targetCandidates: [
        {
          candidate: targetCandidate({ id: "missing-source", source: null }),
          geocode: {
            status: "ok",
            coordinates: [-122.402, 37.793],
            markerPrecision: "exact",
            formattedAddress: "122 Pine St, San Francisco, CA",
          },
        },
        {
          candidate: targetCandidate({ id: "duplicate-address" }),
          geocode: {
            status: "ok",
            coordinates: [-122.40101, 37.79201],
            markerPrecision: "exact",
            formattedAddress: "120 Pine St, San Francisco, CA",
          },
        },
        {
          candidate: targetCandidate({
            id: "failed-geocode",
            geocodeQuery: "Not a real SF address",
          }),
          geocode: { status: "failed", error: "No geocode result found." },
        },
        {
          candidate: targetCandidate({ id: "outside-sf" }),
          geocode: { status: "outside_sf", error: "Geocode result is outside San Francisco." },
        },
      ],
      corridorCandidates: [],
      caveats: [],
    });

    expect(result.outcome.kind).toBe("noAction");
    expect(result.researchSummary.exclusions.map((item) => item.reason)).toEqual([
      "missing_source",
      "duplicate",
      "geocode_failed",
      "out_of_bounds",
    ]);
  });

  it("converts official corridor geometry only when the server marked it official", () => {
    const officialLine: LineStringGeometry = {
      type: "LineString",
      coordinates: [
        [-122.464, 37.785],
        [-122.421, 37.79],
        [-122.397, 37.795],
      ],
    };

    const result = buildResearchedMapProposal({
      mapState: seedMapState,
      targetCandidates: [],
      corridorCandidates: [
        {
          candidate: corridorCandidate({
            requestedGeometryQuality: "official",
            sourcedLineString: officialLine,
          }),
          resolvedGeometryQuality: "official",
          geometry: officialLine,
        },
      ],
      caveats: [],
    });

    expect(result.outcome.kind).toBe("proposal");
    if (result.outcome.kind !== "proposal") {
      throw new Error("Expected proposal outcome.");
    }

    expect(result.outcome.proposal.operations[0]).toEqual({
      type: "addCorridor",
      corridor: {
        id: "muni-1-california",
        name: "Muni 1 California",
        geometry: officialLine,
        priority: "high",
        tags: ["transit"],
        notes: ["Planning corridor from researched route evidence."],
      },
    });
    expect(result.outcome.researchSummary.items[0]).toMatchObject({
      entityId: "muni-1-california",
      operationType: "addCorridor",
      geometryQuality: "official",
    });
  });

  it("downgrades model-supplied corridor coordinates to approximate when no official resolver verified them", () => {
    const modelLine: LineStringGeometry = {
      type: "LineString",
      coordinates: [
        [-122.464, 37.785],
        [-122.421, 37.79],
      ],
    };

    const result = buildResearchedMapProposal({
      mapState: seedMapState,
      targetCandidates: [],
      corridorCandidates: [
        {
          candidate: corridorCandidate({
            requestedGeometryQuality: "official",
            sourcedLineString: modelLine,
            caveats: ["Model supplied line coordinates from source text."],
          }),
          resolvedGeometryQuality: "approximate",
          geometry: modelLine,
        },
      ],
      caveats: [],
    });

    expect(result.outcome.kind).toBe("proposal");
    if (result.outcome.kind !== "proposal") {
      throw new Error("Expected proposal outcome.");
    }

    expect(result.outcome.researchSummary.items[0]?.geometryQuality).toBe("approximate");
    expect(result.outcome.researchSummary.items[0]?.caveats).toContain(
      "Model supplied line coordinates from source text.",
    );
  });

  it("rejects corridor geometry with out-of-bounds points", () => {
    const outsideLine: LineStringGeometry = {
      type: "LineString",
      coordinates: [
        [-122.464, 37.785],
        [-121.9, 37.3],
      ],
    };

    const result = buildResearchedMapProposal({
      mapState: seedMapState,
      targetCandidates: [],
      corridorCandidates: [
        {
          candidate: corridorCandidate({ sourcedLineString: outsideLine }),
          resolvedGeometryQuality: "approximate",
          geometry: outsideLine,
        },
      ],
      caveats: [],
    });

    expect(result.outcome.kind).toBe("noAction");
    expect(result.researchSummary.exclusions).toEqual([
      expect.objectContaining({
        label: "Muni 1 California",
        reason: "out_of_bounds",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test to confirm it fails**

Run:

```bash
npm run test -- tests/unit/researched-map-proposals.test.ts
```

Expected: FAIL because `researched-map-proposals.ts` does not exist.

- [ ] **Step 3: Implement the pure proposal builder**

Create `lib/map/researched-map-proposals.ts` with these exported types and functions:

```ts
import type {
  Coordinate,
  CorridorGeometryQuality,
  LineStringGeometry,
  MapAssistantOutcome,
  MapPatchProposal,
  MapState,
  ResearchCorridorCandidate,
  ResearchExclusion,
  ResearchSummary,
  ResearchSummaryItem,
  ResearchTargetCandidate,
} from "@/lib/domain/types";
import { isCoordinateInSfBounds, isLineStringInSfBounds } from "@/lib/map/sf-bounds";

export type ResearchedTargetWithGeocode = {
  candidate: ResearchTargetCandidate;
  geocode:
    | {
        status: "ok";
        coordinates: Coordinate;
        markerPrecision: "exact" | "approximate";
        formattedAddress: string;
      }
    | { status: "failed" | "outside_sf" | "over_cap"; error: string };
};

export type ResolvedResearchCorridor = {
  candidate: ResearchCorridorCandidate;
  resolvedGeometryQuality: CorridorGeometryQuality;
  geometry: LineStringGeometry | null;
};

export type BuildResearchedMapProposalResult = {
  outcome: MapAssistantOutcome;
  researchSummary: ResearchSummary;
};

const TARGET_DUPLICATE_DISTANCE_METERS = 50;
const EARTH_RADIUS_METERS = 6_371_000;

export function buildResearchedMapProposal({
  mapState,
  targetCandidates,
  corridorCandidates,
  caveats,
}: {
  mapState: MapState;
  targetCandidates: ResearchedTargetWithGeocode[];
  corridorCandidates: ResolvedResearchCorridor[];
  caveats: string[];
}): BuildResearchedMapProposalResult {
  const proposal: MapPatchProposal = {
    summary: "Review researched map additions.",
    operations: [],
    confidence: "medium",
    requiresUserReview: true,
  };
  const researchSummary: ResearchSummary = {
    items: [],
    exclusions: [],
    caveats: [...caveats],
  };
  const seenIds = new Set([
    ...mapState.zones.map((zone) => zone.id),
    ...mapState.corridors.map((corridor) => corridor.id),
    ...mapState.targets.map((target) => target.id),
  ]);
  const seenTargetSources = new Set<string>();
  const seenTargetQueries = new Set<string>();
  const seenCorridorSources = new Set<string>();
  const seenCorridorNames = new Set<string>();

  for (const candidate of targetCandidates) {
    const exclusion = getTargetExclusion({
      mapState,
      candidate,
      seenIds,
      seenTargetSources,
      seenTargetQueries,
    });

    if (exclusion) {
      researchSummary.exclusions.push(exclusion);
      continue;
    }

    if (candidate.geocode.status !== "ok") {
      researchSummary.exclusions.push({
        label: candidate.candidate.name,
        reason: candidate.geocode.status === "over_cap" ? "over_cap" : "geocode_failed",
        source: candidate.candidate.source ?? undefined,
        caveats: [candidate.geocode.error],
      });
      continue;
    }

    const operation = {
      type: "addTarget" as const,
      target: {
        id: candidate.candidate.id,
        name: candidate.candidate.name,
        purpose: candidate.candidate.purpose,
        coordinates: candidate.geocode.coordinates,
        priority: candidate.candidate.priority,
        influence: candidate.candidate.influence,
        radiusMinutes: candidate.candidate.radiusMinutes,
        notes: candidate.candidate.notes,
      },
    };
    proposal.operations.push(operation);
    researchSummary.items.push({
      entityId: candidate.candidate.id,
      operationType: "addTarget",
      label: candidate.candidate.name,
      source: candidate.candidate.source,
      confidence: candidate.candidate.confidence,
      geocodePrecision: candidate.geocode.markerPrecision,
      caveats: candidate.candidate.caveats,
    } satisfies ResearchSummaryItem);
    rememberTargetCandidate(candidate, seenIds, seenTargetSources, seenTargetQueries);
  }

  for (const candidate of corridorCandidates) {
    const exclusion = getCorridorExclusion({
      mapState,
      candidate,
      seenIds,
      seenCorridorSources,
      seenCorridorNames,
    });

    if (exclusion) {
      researchSummary.exclusions.push(exclusion);
      continue;
    }

    if (!candidate.geometry || !isLineStringInSfBounds(candidate.geometry)) {
      researchSummary.exclusions.push({
        label: candidate.candidate.name,
        reason: candidate.geometry ? "out_of_bounds" : "invalid_geometry",
        source: candidate.candidate.source ?? undefined,
        caveats: candidate.candidate.caveats,
      });
      continue;
    }

    proposal.operations.push({
      type: "addCorridor",
      corridor: {
        id: candidate.candidate.id,
        name: candidate.candidate.name,
        geometry: candidate.geometry,
        priority: candidate.candidate.priority,
        tags: candidate.candidate.tags,
        notes: candidate.candidate.notes,
      },
    });
    researchSummary.items.push({
      entityId: candidate.candidate.id,
      operationType: "addCorridor",
      label: candidate.candidate.name,
      source: candidate.candidate.source,
      confidence: candidate.candidate.confidence,
      geometryQuality: candidate.resolvedGeometryQuality,
      caveats: candidate.candidate.caveats,
    } satisfies ResearchSummaryItem);
    rememberCorridorCandidate(candidate, seenIds, seenCorridorSources, seenCorridorNames);
  }

  if (proposal.operations.length === 0) {
    return {
      outcome: {
        kind: "noAction",
        assistantMessage: "I could not create a safe sourced map proposal from those results.",
        caveats: [...researchSummary.caveats, ...researchSummary.exclusions.flatMap((item) => item.caveats)],
      },
      researchSummary,
    };
  }

  return {
    outcome: {
      kind: "proposal",
      assistantMessage: "I found researched map additions for review.",
      proposal,
      researchSummary,
    },
    researchSummary,
  };
}
```

Then add the helper functions in the same file:

```ts
export function normalizeResearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeResearchSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim();
  }
}

function getTargetExclusion({
  mapState,
  candidate,
  seenIds,
  seenTargetSources,
  seenTargetQueries,
}: {
  mapState: MapState;
  candidate: ResearchedTargetWithGeocode;
  seenIds: Set<string>;
  seenTargetSources: Set<string>;
  seenTargetQueries: Set<string>;
}): ResearchExclusion | null {
  if (!candidate.candidate.source) {
    return {
      label: candidate.candidate.name,
      reason: "missing_source",
      caveats: ["A researched target must include a source citation."],
    };
  }

  if (seenIds.has(candidate.candidate.id)) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["A map entity with this id already exists."],
    };
  }

  const canonicalSource = canonicalizeResearchSourceUrl(candidate.candidate.source.url);
  if (seenTargetSources.has(canonicalSource)) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["A researched target from this source was already included."],
    };
  }

  const normalizedQuery = normalizeResearchText(
    candidate.candidate.address ?? candidate.candidate.geocodeQuery,
  );
  if (seenTargetQueries.has(normalizedQuery)) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["A researched target with this address was already included."],
    };
  }

  if (candidate.geocode.status === "outside_sf") {
    return {
      label: candidate.candidate.name,
      reason: "out_of_bounds",
      source: candidate.candidate.source,
      caveats: [candidate.geocode.error],
    };
  }

  if (candidate.geocode.status === "ok" && !isCoordinateInSfBounds(candidate.geocode.coordinates)) {
    return {
      label: candidate.candidate.name,
      reason: "out_of_bounds",
      source: candidate.candidate.source,
      caveats: ["The server geocode result is outside San Francisco."],
    };
  }

  if (
    candidate.geocode.status === "ok" &&
    mapState.targets.some((target) => {
      const nameMatches =
        normalizeResearchText(target.name) === normalizeResearchText(candidate.candidate.name);
      return (
        nameMatches &&
        distanceMeters(target.coordinates, candidate.geocode.coordinates) <=
          TARGET_DUPLICATE_DISTANCE_METERS
      );
    })
  ) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["An existing target with the same name is already near this location."],
    };
  }

  return null;
}

function rememberTargetCandidate(
  candidate: ResearchedTargetWithGeocode,
  seenIds: Set<string>,
  seenTargetSources: Set<string>,
  seenTargetQueries: Set<string>,
) {
  seenIds.add(candidate.candidate.id);
  if (candidate.candidate.source) {
    seenTargetSources.add(canonicalizeResearchSourceUrl(candidate.candidate.source.url));
  }
  seenTargetQueries.add(normalizeResearchText(candidate.candidate.address ?? candidate.candidate.geocodeQuery));
}

function getCorridorExclusion({
  mapState,
  candidate,
  seenIds,
  seenCorridorSources,
  seenCorridorNames,
}: {
  mapState: MapState;
  candidate: ResolvedResearchCorridor;
  seenIds: Set<string>;
  seenCorridorSources: Set<string>;
  seenCorridorNames: Set<string>;
}): ResearchExclusion | null {
  if (!candidate.candidate.source) {
    return {
      label: candidate.candidate.name,
      reason: "missing_source",
      caveats: ["A researched corridor must include a source citation."],
    };
  }

  if (seenIds.has(candidate.candidate.id)) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["A map entity with this id already exists."],
    };
  }

  const canonicalSource = canonicalizeResearchSourceUrl(candidate.candidate.source.url);
  if (seenCorridorSources.has(canonicalSource)) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["A researched corridor from this source was already included."],
    };
  }

  const normalizedName = normalizeResearchText(candidate.candidate.name);
  if (
    seenCorridorNames.has(normalizedName) ||
    mapState.corridors.some((corridor) => normalizeResearchText(corridor.name) === normalizedName)
  ) {
    return {
      label: candidate.candidate.name,
      reason: "duplicate",
      source: candidate.candidate.source,
      caveats: ["A corridor with this route or corridor name already exists."],
    };
  }

  return null;
}

function rememberCorridorCandidate(
  candidate: ResolvedResearchCorridor,
  seenIds: Set<string>,
  seenCorridorSources: Set<string>,
  seenCorridorNames: Set<string>,
) {
  seenIds.add(candidate.candidate.id);
  if (candidate.candidate.source) {
    seenCorridorSources.add(canonicalizeResearchSourceUrl(candidate.candidate.source.url));
  }
  seenCorridorNames.add(normalizeResearchText(candidate.candidate.name));
}

function distanceMeters(a: Coordinate, b: Coordinate) {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const deltaLat = toRadians(b[1] - a[1]);
  const deltaLng = toRadians(b[0] - a[0]);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
```

Leave notes and caveats unmodified in this task; schema parsing remains responsible for rejecting over-cap arrays or strings. Do not add local truncation in the pure builder.

- [ ] **Step 4: Run the focused pure tests**

Run:

```bash
npm run test -- tests/unit/researched-map-proposals.test.ts tests/unit/research-summary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git status --short
git add lib/map/researched-map-proposals.ts tests/unit/researched-map-proposals.test.ts
git commit -m "Build researched map proposals"
```

Expected: one commit containing only the pure builder and its tests.

## Task 3: Server Geocoding Quotas And Official Geometry Resolver

**Files:**
- Create: `lib/server/map-research-geocode.ts`
- Create: `lib/server/research-geometry-source.ts`
- Test: `tests/unit/map-research-geocode.test.ts`
- Test: `tests/unit/researched-map-proposals.test.ts`

- [ ] **Step 1: Write failing quota tests**

Add `tests/unit/map-research-geocode.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_MAP_RESEARCH_CORRIDOR_CANDIDATES,
  MAX_MAP_RESEARCH_GEOCODE_ATTEMPTS_PER_REQUEST,
  MAX_MAP_RESEARCH_TARGET_CANDIDATES,
  geocodeMapResearchQueries,
  getMapResearchRateLimitKeys,
} from "@/lib/server/map-research-geocode";

vi.mock("@/lib/server/google-geocode", () => ({
  geocodeListingLocation: vi.fn(async ({ query }: { query: string }) => ({
    status: "ok",
    coordinates: query.includes("Van Ness") ? [-122.421, 37.79] : [-122.401, 37.792],
    markerPrecision: "exact",
    formattedAddress: query,
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  createRedisFromEnv: vi.fn(() => ({
    set: vi.fn(),
    incr: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
  })),
  checkFixedWindowRateLimit: vi.fn(async () => ({
    ok: true,
    remaining: 49,
    resetAt: new Date("2026-06-18T00:00:00.000Z"),
  })),
}));

describe("map research geocoding", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("exports tight candidate and per-request caps", () => {
    expect(MAX_MAP_RESEARCH_TARGET_CANDIDATES).toBe(20);
    expect(MAX_MAP_RESEARCH_CORRIDOR_CANDIDATES).toBe(5);
    expect(MAX_MAP_RESEARCH_GEOCODE_ATTEMPTS_PER_REQUEST).toBe(25);
  });

  it("uses separate hashed IP and session keys", () => {
    const request = new Request("http://localhost/api/ai/map-assistant", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.2",
        "x-sf-apt-session": "session-1",
      },
    });

    expect(getMapResearchRateLimitKeys(request)).toEqual({
      ipKey: expect.stringMatching(/^geocode:map-research:ip:[a-f0-9]{64}$/),
      sessionKey: expect.stringMatching(/^geocode:map-research:session:[a-f0-9]{64}$/),
    });
  });

  it("marks over-cap queries before calling Google", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-test");
    const queries = Array.from({ length: 27 }, (_, index) => ({
      id: `candidate-${index}`,
      query: `${index} Pine St, San Francisco, CA`,
    }));

    const result = await geocodeMapResearchQueries({
      request: new Request("http://localhost/api/ai/map-assistant"),
      queries,
    });

    expect(result.results).toHaveLength(27);
    expect(result.results.slice(0, 25).every((item) => item.geocode.status === "ok")).toBe(true);
    expect(result.results.slice(25)).toEqual([
      {
        id: "candidate-25",
        geocode: { status: "over_cap", error: "Map research geocode cap exceeded." },
      },
      {
        id: "candidate-26",
        geocode: { status: "over_cap", error: "Map research geocode cap exceeded." },
      },
    ]);
  });

  it("fails closed in production when Redis is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-test");
    const rateLimitModule = await import("@/lib/server/rate-limit");
    vi.mocked(rateLimitModule.createRedisFromEnv).mockReturnValueOnce(null);

    const result = await geocodeMapResearchQueries({
      request: new Request("http://localhost/api/ai/map-assistant"),
      queries: [{ id: "candidate-1", query: "120 Pine St, San Francisco, CA" }],
    });

    expect(result.results).toEqual([
      {
        id: "candidate-1",
        geocode: {
          status: "failed",
          error: "Rate limiting is not configured.",
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run quota tests to confirm they fail**

Run:

```bash
npm run test -- tests/unit/map-research-geocode.test.ts
```

Expected: FAIL because `map-research-geocode.ts` does not exist.

- [ ] **Step 3: Implement server-side researched geocoding**

Create `lib/server/map-research-geocode.ts`:

```ts
import { createHash } from "node:crypto";

import type { ListingGeocodeResult } from "@/lib/server/google-geocode";
import { geocodeListingLocation } from "@/lib/server/google-geocode";
import { checkFixedWindowRateLimit, createRedisFromEnv } from "@/lib/server/rate-limit";
import { redactSecrets } from "@/lib/server/redaction";

export const MAX_MAP_RESEARCH_TARGET_CANDIDATES = 20;
export const MAX_MAP_RESEARCH_CORRIDOR_CANDIDATES = 5;
export const MAX_MAP_RESEARCH_GEOCODE_ATTEMPTS_PER_REQUEST = 25;
export const MAP_RESEARCH_GEOCODE_RATE_LIMIT = 50;
export const MAP_RESEARCH_GEOCODE_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

export type MapResearchGeocodeQuery = {
  id: string;
  query: string;
};

export type MapResearchGeocodeResult = {
  id: string;
  geocode:
    | Extract<ListingGeocodeResult, { status: "ok" }>
    | { status: "failed" | "outside_sf" | "over_cap"; error: string };
};

export async function geocodeMapResearchQueries({
  request,
  queries,
}: {
  request: Request;
  queries: MapResearchGeocodeQuery[];
}): Promise<{ results: MapResearchGeocodeResult[]; caveats: string[] }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const caveats: string[] = [];

  if (!apiKey) {
    return {
      results: queries.map((query) => ({
        id: query.id,
        geocode: { status: "failed", error: "Geocoding is not configured." },
      })),
      caveats: ["Geocoding is not configured."],
    };
  }

  const redis = createRedisFromEnv();

  if (!redis && process.env.NODE_ENV === "production") {
    return {
      results: queries.map((query) => ({
        id: query.id,
        geocode: { status: "failed", error: "Rate limiting is not configured." },
      })),
      caveats: ["Rate limiting is not configured."],
    };
  }

  const results: MapResearchGeocodeResult[] = [];

  for (const [index, query] of queries.entries()) {
    if (index >= MAX_MAP_RESEARCH_GEOCODE_ATTEMPTS_PER_REQUEST) {
      results.push({
        id: query.id,
        geocode: { status: "over_cap", error: "Map research geocode cap exceeded." },
      });
      continue;
    }

    if (redis) {
      const { ipKey, sessionKey } = getMapResearchRateLimitKeys(request);
      const rateLimitResults = await Promise.all([
        checkFixedWindowRateLimit({
          redis,
          key: ipKey,
          limit: MAP_RESEARCH_GEOCODE_RATE_LIMIT,
          windowSeconds: MAP_RESEARCH_GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
        }),
        checkFixedWindowRateLimit({
          redis,
          key: sessionKey,
          limit: MAP_RESEARCH_GEOCODE_RATE_LIMIT,
          windowSeconds: MAP_RESEARCH_GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
        }),
      ]);

      if (rateLimitResults.some((rateLimit) => !rateLimit.ok)) {
        results.push({
          id: query.id,
          geocode: { status: "over_cap", error: "Map research geocode quota exceeded." },
        });
        continue;
      }
    }

    const geocode = await geocodeListingLocation({ apiKey, query: query.query });

    if (geocode.status === "ok") {
      results.push({ id: query.id, geocode });
      continue;
    }

    results.push({
      id: query.id,
      geocode: {
        status: geocode.status,
        error: redactSecrets(geocode.error),
      },
    });
  }

  return { results, caveats };
}

export function getMapResearchRateLimitKeys(request: Request) {
  return {
    ipKey: `geocode:map-research:ip:${hashValue(getClientIp(request))}`,
    sessionKey: `geocode:map-research:session:${hashValue(getClientSession(request))}`,
  };
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown-ip";
  return forwardedFor.split(",")[0]?.trim() || "unknown-ip";
}

function getClientSession(request: Request) {
  return request.headers.get("x-sf-apt-session")?.trim() || "unknown-session";
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
```

- [ ] **Step 4: Add official GeoJSON LineString resolver tests**

Extend `tests/unit/researched-map-proposals.test.ts` or add `tests/unit/research-geometry-source.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveOfficialCorridorGeometry } from "@/lib/server/research-geometry-source";

describe("resolveOfficialCorridorGeometry", () => {
  it("parses a cited GeoJSON LineString as official geometry", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [-122.464, 37.785],
              [-122.421, 37.79],
              [-122.397, 37.795],
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/geo+json" } },
      );
    });

    await expect(
      resolveOfficialCorridorGeometry({
        url: "https://data.sfgov.org/resource/muni-route-1.geojson",
        fetchImpl,
      }),
    ).resolves.toEqual({
      status: "ok",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.464, 37.785],
          [-122.421, 37.79],
          [-122.397, 37.795],
        ],
      },
    });
  });

  it("rejects invalid or out-of-bounds official geometry", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          type: "LineString",
          coordinates: [
            [-122.464, 37.785],
            [-121.9, 37.3],
          ],
        }),
        { status: 200 },
      );
    });

    await expect(
      resolveOfficialCorridorGeometry({
        url: "https://data.sfgov.org/resource/outside.geojson",
        fetchImpl,
      }),
    ).resolves.toEqual({
      status: "failed",
      error: "Official geometry is invalid or outside San Francisco.",
    });
  });
});
```

- [ ] **Step 5: Implement the official geometry resolver**

Create `lib/server/research-geometry-source.ts`:

```ts
import type { LineStringGeometry } from "@/lib/domain/types";
import { lineStringGeometrySchema } from "@/lib/domain/schemas";
import { isLineStringInSfBounds } from "@/lib/map/sf-bounds";
import { redactSecrets } from "@/lib/server/redaction";

const MAX_OFFICIAL_GEOMETRY_BYTES = 1_000_000;

export type OfficialGeometryResult =
  | { status: "ok"; geometry: LineStringGeometry }
  | { status: "failed"; error: string };

export async function resolveOfficialCorridorGeometry({
  url,
  fetchImpl = fetch,
}: {
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<OfficialGeometryResult> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return { status: "failed", error: "Official geometry URL is invalid." };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { status: "failed", error: "Official geometry URL must use http or https." };
  }

  try {
    const response = await fetchImpl(parsedUrl);
    if (!response.ok) {
      return { status: "failed", error: "Official geometry request failed." };
    }

    const text = await response.text();
    if (new Blob([text]).size > MAX_OFFICIAL_GEOMETRY_BYTES) {
      return { status: "failed", error: "Official geometry response is too large." };
    }

    const data: unknown = JSON.parse(text);
    const geometry = extractGeoJsonLineString(data);
    const parsed = lineStringGeometrySchema.safeParse(geometry);

    if (!parsed.success || !isLineStringInSfBounds(parsed.data)) {
      return {
        status: "failed",
        error: "Official geometry is invalid or outside San Francisco.",
      };
    }

    return { status: "ok", geometry: parsed.data };
  } catch (error) {
    return {
      status: "failed",
      error: redactSecrets(error instanceof Error ? error.message : "Official geometry failed."),
    };
  }
}

function extractGeoJsonLineString(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (value.type === "LineString") {
    return value;
  }

  if (value.type === "Feature" && isRecord(value.geometry)) {
    return value.geometry;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
```

This v1 resolver labels a corridor `official` only for deterministic GeoJSON LineString parsing. GTFS, KML, and encoded polyline parsing are outside this implementation and require a separate plan.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run test -- tests/unit/map-research-geocode.test.ts tests/unit/researched-map-proposals.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git status --short
git add lib/server/map-research-geocode.ts lib/server/research-geometry-source.ts tests/unit/map-research-geocode.test.ts tests/unit/researched-map-proposals.test.ts
git commit -m "Protect researched map geocoding"
```

Expected: one commit containing only Task 3 files.

## Task 4: Map Assistant Route Integration

**Files:**
- Modify: `app/api/ai/map-assistant/route.ts`
- Modify: `lib/domain/schemas.ts`
- Test: `tests/routes/map-assistant-route.test.ts`

- [ ] **Step 1: Re-read Next route-handler docs**

Run:

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
```

Expected: docs render locally. Follow current App Router route-handler conventions.

- [ ] **Step 2: Write failing route tests for outcome shape and web search**

Update `tests/routes/map-assistant-route.test.ts` with a test that expects `tools: [{ type: "web_search" }]`, `store: false`, and the new public `proposal` outcome:

```ts
it("sends web search to OpenAI and returns a public proposal outcome", async () => {
  const openAiOutcome = {
    kind: "proposal",
    assistantMessage: "I found one map update worth reviewing.",
    proposal: {
      summary: "Add a renter note to Lower Pac Heights.",
      operations: [
        {
          type: "addNote",
          entityId: "lower-pac-heights",
          note: "Watch for studio listings near Fillmore with good bus access.",
        },
      ],
      confidence: "high",
      requiresUserReview: true,
    },
    researchSummary: { items: [], exclusions: [], caveats: [] },
  };
  const fetchMock = mockOpenAiResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(openAiOutcome) }] }],
  });

  const response = await POST(
    createRequest(
      {
        message: "Add a note about Lower Pac Heights.",
        mapState: seedMapState,
        selectedZoneIds: ["lower-pac-heights"],
      },
      "Bearer sk-test-map",
    ),
  );
  const body = await response.json();
  const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

  expect(response.status).toBe(200);
  expect(body).toEqual(openAiOutcome);
  expect(payload.store).toBe(false);
  expect(payload.tools).toEqual([{ type: "web_search" }]);
  expect(payload.text.format).toMatchObject({
    type: "json_schema",
    strict: true,
    name: "map_assistant_model_response",
  });
});
```

Add tests for `needsMoreInfo` and `noAction`:

```ts
it("returns needsMoreInfo as a successful assistant outcome", async () => {
  const outcome = {
    kind: "needsMoreInfo",
    assistantMessage: "Do you want pins, corridors, or both?",
    missingInformation: ["object to create"],
  };
  mockOpenAiResponse({ output_text: JSON.stringify(outcome) });

  const response = await POST(
    createRequest(
      { message: "Map useful fitness stuff.", mapState: seedMapState },
      "Bearer sk-test-map",
    ),
  );

  await expect(response.json()).resolves.toEqual(outcome);
  expect(response.status).toBe(200);
});

it("returns noAction for a safe model no-action response", async () => {
  const outcome = {
    kind: "noAction",
    assistantMessage: "I could not verify a sourced SF map change.",
    caveats: ["No source matched the request."],
  };
  mockOpenAiResponse({ output_text: JSON.stringify(outcome) });

  const response = await POST(
    createRequest(
      { message: "Map an imaginary place.", mapState: seedMapState },
      "Bearer sk-test-map",
    ),
  );

  await expect(response.json()).resolves.toEqual(outcome);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 3: Write failing route tests for researched target enrichment**

Add:

```ts
vi.mock("@/lib/server/map-research-geocode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/map-research-geocode")>();
  return {
    ...actual,
    geocodeMapResearchQueries: vi.fn(async () => ({
      caveats: [],
      results: [
        {
          id: "otf-fi-di",
          geocode: {
            status: "ok",
            coordinates: [-122.401, 37.792],
            markerPrecision: "exact",
            formattedAddress: "120 Pine St, San Francisco, CA",
          },
        },
      ],
    })),
  };
});

it("geocodes researched target candidates and ignores model coordinates", async () => {
  mockOpenAiResponse({
    output_text: JSON.stringify({
      kind: "research",
      assistantMessage: "I found one sourced studio.",
      targetCandidates: [
        {
          id: "otf-fi-di",
          name: "Orangetheory Fitness Financial District",
          address: "120 Pine St, San Francisco, CA",
          geocodeQuery: "120 Pine St, San Francisco, CA",
          source: {
            url: "https://www.orangetheory.com/en-us/locations/california/san-francisco/financial-district",
            title: "Orangetheory Financial District",
            sourceDomain: "orangetheory.com",
          },
          purpose: "fitness anchor",
          influence: "positive",
          priority: "high",
          radiusMinutes: 10,
          notes: ["Researched studio."],
          confidence: "high",
          caveats: [],
          modelCoordinates: [-73.985, 40.758],
        },
      ],
      corridorCandidates: [],
      caveats: [],
    }),
  });

  const response = await POST(
    createRequest(
      { message: "Create pins for Orange Theory locations in SF.", mapState: seedMapState },
      "Bearer sk-test-map",
      { "x-sf-apt-session": "session-1" },
    ),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.kind).toBe("proposal");
  expect(body.proposal.operations[0].target.coordinates).toEqual([-122.401, 37.792]);
  expect(body.researchSummary.items[0]).toMatchObject({
    entityId: "otf-fi-di",
    geocodePrecision: "exact",
  });
});
```

Change `createRequest` to accept extra headers:

```ts
function createRequest(
  body: unknown,
  authorization?: string,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/ai/map-assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 4: Write failing route tests for corridors and validation**

Add this mock near the other route-test mocks:

```ts
vi.mock("@/lib/server/research-geometry-source", () => ({
  resolveOfficialCorridorGeometry: vi.fn(async () => ({
    status: "failed",
    error: "Official geometry request failed.",
  })),
}));
```

Add these tests:

```ts
it("converts a server-verified official corridor into addCorridor metadata", async () => {
  const geometryModule = await import("@/lib/server/research-geometry-source");
  const officialGeometry = {
    type: "LineString" as const,
    coordinates: [
      [-122.464, 37.785],
      [-122.421, 37.79],
      [-122.397, 37.795],
    ],
  };
  vi.mocked(geometryModule.resolveOfficialCorridorGeometry).mockResolvedValueOnce({
    status: "ok",
    geometry: officialGeometry,
  });
  mockOpenAiResponse({
    output_text: JSON.stringify({
      kind: "research",
      assistantMessage: "I found an official route geometry source.",
      targetCandidates: [],
      corridorCandidates: [
        {
          id: "muni-1-california",
          name: "Muni 1 California",
          source: {
            url: "https://www.sfmta.com/routes/1-california",
            title: "1 California",
            sourceDomain: "sfmta.com",
          },
          priority: "high",
          tags: ["transit"],
          notes: ["SFMTA route evidence."],
          confidence: "high",
          requestedGeometryQuality: "official",
          officialGeometryUrl: "https://data.sfgov.org/resource/muni-1-california.geojson",
          sourcedLineString: null,
          orderedWaypoints: [],
          routeDescription: null,
          caveats: [],
        },
      ],
      caveats: [],
    }),
  });

  const response = await POST(
    createRequest(
      { message: "Create a corridor where the 1 California bus runs.", mapState: seedMapState },
      "Bearer sk-test-map",
      { "x-sf-apt-session": "session-1" },
    ),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.kind).toBe("proposal");
  expect(body.proposal.operations[0]).toEqual({
    type: "addCorridor",
    corridor: {
      id: "muni-1-california",
      name: "Muni 1 California",
      geometry: officialGeometry,
      priority: "high",
      tags: ["transit"],
      notes: ["SFMTA route evidence."],
    },
  });
  expect(body.researchSummary.items[0]).toMatchObject({
    entityId: "muni-1-california",
    operationType: "addCorridor",
    geometryQuality: "official",
  });
});

it("builds a fromStops corridor from ordered waypoint coordinates", async () => {
  mockOpenAiResponse({
    output_text: JSON.stringify({
      kind: "research",
      assistantMessage: "I found ordered route waypoints.",
      targetCandidates: [],
      corridorCandidates: [
        {
          id: "muni-1-california",
          name: "Muni 1 California",
          source: {
            url: "https://www.sfmta.com/routes/1-california",
            title: "1 California",
            sourceDomain: "sfmta.com",
          },
          priority: "high",
          tags: ["transit"],
          notes: ["Built from ordered stop evidence."],
          confidence: "medium",
          requestedGeometryQuality: "fromStops",
          officialGeometryUrl: null,
          sourcedLineString: null,
          orderedWaypoints: [
            {
              label: "California St & 6th Ave",
              geocodeQuery: null,
              coordinates: [-122.464, 37.785],
            },
            {
              label: "California St & Van Ness",
              geocodeQuery: null,
              coordinates: [-122.421, 37.79],
            },
            {
              label: "Drumm St & Clay St",
              geocodeQuery: null,
              coordinates: [-122.397, 37.795],
            },
          ],
          routeDescription: null,
          caveats: [],
        },
      ],
      caveats: [],
    }),
  });

  const response = await POST(
    createRequest(
      { message: "Create a corridor where the 1 California bus runs.", mapState: seedMapState },
      "Bearer sk-test-map",
      { "x-sf-apt-session": "session-1" },
    ),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.kind).toBe("proposal");
  expect(body.proposal.operations[0].corridor.geometry).toEqual({
    type: "LineString",
    coordinates: [
      [-122.464, 37.785],
      [-122.421, 37.79],
      [-122.397, 37.795],
    ],
  });
  expect(body.researchSummary.items[0]).toMatchObject({
    entityId: "muni-1-california",
    geometryQuality: "fromStops",
  });
});

it("labels raw model corridor coordinates as approximate when official resolution fails", async () => {
  mockOpenAiResponse({
    output_text: JSON.stringify({
      kind: "research",
      assistantMessage: "I found an approximate route line.",
      targetCandidates: [],
      corridorCandidates: [
        {
          id: "muni-1-california",
          name: "Muni 1 California",
          source: {
            url: "https://www.sfmta.com/routes/1-california",
            title: "1 California",
            sourceDomain: "sfmta.com",
          },
          priority: "high",
          tags: ["transit"],
          notes: ["Approximate route line."],
          confidence: "medium",
          requestedGeometryQuality: "official",
          officialGeometryUrl: "https://data.sfgov.org/resource/missing-route.geojson",
          sourcedLineString: {
            type: "LineString",
            coordinates: [
              [-122.464, 37.785],
              [-122.421, 37.79],
            ],
          },
          orderedWaypoints: [],
          routeDescription: null,
          caveats: ["Could not verify machine-readable route geometry."],
        },
      ],
      caveats: [],
    }),
  });

  const response = await POST(
    createRequest(
      { message: "Create a corridor where the 1 California bus runs.", mapState: seedMapState },
      "Bearer sk-test-map",
      { "x-sf-apt-session": "session-1" },
    ),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.kind).toBe("proposal");
  expect(body.researchSummary.items[0]).toMatchObject({
    entityId: "muni-1-california",
    geometryQuality: "approximate",
    caveats: ["Could not verify machine-readable route geometry."],
  });
});

it("rejects invalid corridor geometry and returns noAction when every researched candidate fails", async () => {
  mockOpenAiResponse({
    output_text: JSON.stringify({
      kind: "research",
      assistantMessage: "I could not build a safe corridor from those results.",
      targetCandidates: [],
      corridorCandidates: [
        {
          id: "outside-route",
          name: "Outside route",
          source: {
            url: "https://www.sfmta.com/routes/outside",
            title: "Outside route",
            sourceDomain: "sfmta.com",
          },
          priority: "medium",
          tags: ["transit"],
          notes: [],
          confidence: "low",
          requestedGeometryQuality: "approximate",
          officialGeometryUrl: null,
          sourcedLineString: {
            type: "LineString",
            coordinates: [
              [-122.464, 37.785],
              [-121.9, 37.3],
            ],
          },
          orderedWaypoints: [],
          routeDescription: null,
          caveats: ["One point is outside San Francisco."],
        },
      ],
      caveats: [],
    }),
  });

  const response = await POST(
    createRequest(
      { message: "Create a corridor for this route.", mapState: seedMapState },
      "Bearer sk-test-map",
      { "x-sf-apt-session": "session-1" },
    ),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.kind).toBe("noAction");
  expect(body.assistantMessage).toContain("safe");
});

it("fails validation when researchSummary items do not match proposal operations", async () => {
  mockOpenAiResponse({
    output_text: JSON.stringify({
      kind: "proposal",
      assistantMessage: "I found one researched target.",
      proposal: {
        summary: "Add target A.",
        operations: [
          {
            type: "addTarget",
            target: {
              id: "target-a",
              name: "Target A",
              purpose: "fitness anchor",
              coordinates: [-122.401, 37.792],
              priority: "high",
              influence: "positive",
              radiusMinutes: 10,
              notes: [],
            },
          },
        ],
        confidence: "high",
        requiresUserReview: true,
      },
      researchSummary: {
        items: [
          {
            entityId: "target-b",
            operationType: "addTarget",
            label: "Target B",
            source: {
              url: "https://example.com/target-b",
              title: "Target B",
              sourceDomain: "example.com",
            },
            confidence: "high",
            geocodePrecision: "exact",
            caveats: [],
          },
        ],
        exclusions: [],
        caveats: [],
      },
    }),
  });

  const response = await POST(
    createRequest(
      { message: "Create a researched target.", mapState: seedMapState },
      "Bearer sk-test-map",
    ),
  );
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toBe("Invalid map assistant request.");
  expect(JSON.stringify(body)).not.toContain("sk-test-map");
});
```

- [ ] **Step 5: Implement route request and model-output schemas**

In `app/api/ai/map-assistant/route.ts`:

- Import `mapAssistantOutcomeSchema`, researched candidate schemas from `lib/domain/schemas`, `geocodeMapResearchQueries`, `resolveOfficialCorridorGeometry`, and `buildResearchedMapProposal`.
- Extend `mapAssistantRequestSchema` with:

```ts
conversationContext: z
  .object({
    pendingClarification: z.object({
      originalMessage: z.string().min(1).max(4_000),
      assistantMessage: z.string().min(1).max(4_000),
      missingInformation: z.array(z.string().min(1).max(2_000)).max(20),
    }),
  })
  .strict()
  .optional(),
```

- Replace the old route-local `mapAssistantResponseSchema` with a route-local `mapAssistantModelOutputSchema` that supports the internal `research` branch plus the public `needsMoreInfo`, `proposal`, and `noAction` branches.
- Keep the old `normalizeMapAssistantResponse` behavior for `proposal` branches so nullable strict-JSON-schema fields still become optional Zod fields.
- Use the public `mapAssistantOutcomeSchema` immediately before returning `Response.json(...)`.

- [ ] **Step 6: Implement raw OpenAI JSON schema**

In `app/api/ai/map-assistant/route.ts`, replace `mapAssistantJsonSchema` with `mapAssistantModelJsonSchema`:

```ts
const sourceCitationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url", "title", "sourceDomain"],
  properties: {
    url: { type: "string", minLength: 1, maxLength: 2048 },
    title: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
    sourceDomain: { type: "string", minLength: 1, maxLength: 128 },
  },
};

const researchTargetCandidateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "address",
    "geocodeQuery",
    "source",
    "purpose",
    "influence",
    "priority",
    "radiusMinutes",
    "notes",
    "confidence",
    "caveats",
    "modelCoordinates",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    address: { anyOf: [{ type: "string", minLength: 1, maxLength: 2000 }, { type: "null" }] },
    geocodeQuery: { type: "string", minLength: 1, maxLength: 2000 },
    source: { anyOf: [sourceCitationJsonSchema, { type: "null" }] },
    purpose: { type: "string", minLength: 1, maxLength: 2000 },
    influence: targetInfluenceJsonSchema,
    priority: priorityJsonSchema,
    radiusMinutes: targetRadiusMinutesJsonSchema,
    notes: textArrayJsonSchema,
    confidence: { enum: ["low", "medium", "high"] },
    caveats: textArrayJsonSchema,
    modelCoordinates: { anyOf: [coordinateJsonSchema, { type: "null" }] },
  },
};

const researchCorridorWaypointJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "geocodeQuery", "coordinates"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    geocodeQuery: { anyOf: [{ type: "string", minLength: 1, maxLength: 2000 }, { type: "null" }] },
    coordinates: { anyOf: [coordinateJsonSchema, { type: "null" }] },
  },
};

const researchCorridorCandidateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "source",
    "priority",
    "tags",
    "notes",
    "confidence",
    "requestedGeometryQuality",
    "officialGeometryUrl",
    "sourcedLineString",
    "orderedWaypoints",
    "routeDescription",
    "caveats",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    source: { anyOf: [sourceCitationJsonSchema, { type: "null" }] },
    priority: priorityJsonSchema,
    tags: {
      type: "array",
      maxItems: 5,
      items: { enum: ["fitness", "rent", "transit", "safety", "short-term"] },
    },
    notes: textArrayJsonSchema,
    confidence: { enum: ["low", "medium", "high"] },
    requestedGeometryQuality: { enum: ["official", "fromStops", "approximate"] },
    officialGeometryUrl: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 2048 }, { type: "null" }],
    },
    sourcedLineString: { anyOf: [lineStringJsonSchema, { type: "null" }] },
    orderedWaypoints: {
      type: "array",
      maxItems: 25,
      items: researchCorridorWaypointJsonSchema,
    },
    routeDescription: {
      anyOf: [{ type: "string", minLength: 1, maxLength: 4000 }, { type: "null" }],
    },
    caveats: textArrayJsonSchema,
  },
};
```

Add review-metadata JSON schema objects:

```ts
const researchSummaryItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "entityId",
    "operationType",
    "label",
    "source",
    "confidence",
    "geometryQuality",
    "geocodePrecision",
    "caveats",
  ],
  properties: {
    entityId: { type: "string", minLength: 1, maxLength: 128 },
    operationType: { enum: ["addTarget", "addCorridor"] },
    label: { type: "string", minLength: 1, maxLength: 160 },
    source: sourceCitationJsonSchema,
    confidence: { enum: ["low", "medium", "high"] },
    geometryQuality: {
      anyOf: [{ enum: ["official", "fromStops", "approximate"] }, { type: "null" }],
    },
    geocodePrecision: { anyOf: [{ enum: ["exact", "approximate"] }, { type: "null" }] },
    caveats: textArrayJsonSchema,
  },
};

const researchExclusionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "reason", "source", "caveats"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    reason: {
      enum: [
        "duplicate",
        "out_of_bounds",
        "geocode_failed",
        "missing_source",
        "invalid_geometry",
        "over_cap",
      ],
    },
    source: { anyOf: [sourceCitationJsonSchema, { type: "null" }] },
    caveats: textArrayJsonSchema,
  },
};

const researchSummaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "exclusions", "caveats"],
  properties: {
    items: {
      type: "array",
      maxItems: 50,
      items: researchSummaryItemJsonSchema,
    },
    exclusions: {
      type: "array",
      maxItems: 100,
      items: researchExclusionJsonSchema,
    },
    caveats: textArrayJsonSchema,
  },
};
```

Add the four strict model-output branches and the root schema:

```ts
const needsMoreInfoModelJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "assistantMessage", "missingInformation"],
  properties: {
    kind: { const: "needsMoreInfo" },
    assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
    missingInformation: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 2000 },
    },
  },
};

const noActionModelJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "assistantMessage", "caveats"],
  properties: {
    kind: { const: "noAction" },
    assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
    caveats: textArrayJsonSchema,
  },
};

const proposalModelJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "assistantMessage", "proposal", "researchSummary"],
  properties: {
    kind: { const: "proposal" },
    assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
    proposal: mapPatchProposalJsonSchema,
    researchSummary: researchSummaryJsonSchema,
  },
};

const researchModelJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "assistantMessage", "targetCandidates", "corridorCandidates", "caveats"],
  properties: {
    kind: { const: "research" },
    assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
    targetCandidates: {
      type: "array",
      maxItems: MAX_MAP_RESEARCH_TARGET_CANDIDATES,
      items: researchTargetCandidateJsonSchema,
    },
    corridorCandidates: {
      type: "array",
      maxItems: MAX_MAP_RESEARCH_CORRIDOR_CANDIDATES,
      items: researchCorridorCandidateJsonSchema,
    },
    caveats: textArrayJsonSchema,
  },
};

const mapAssistantModelJsonSchema = {
  anyOf: [
    needsMoreInfoModelJsonSchema,
    noActionModelJsonSchema,
    proposalModelJsonSchema,
    researchModelJsonSchema,
  ],
};
```

Use this schema in the OpenAI request with `name: "map_assistant_model_response"`.

- [ ] **Step 7: Implement route enrichment**

Add these helper functions inside `route.ts`. Import these types and helpers at the top of the file:

```ts
import type {
  Coordinate,
  LineStringGeometry,
  MapAssistantOutcome,
  MapState,
  ResearchCorridorCandidate,
  ResearchTargetCandidate,
} from "@/lib/domain/types";
import {
  type MapResearchGeocodeResult,
  geocodeMapResearchQueries,
} from "@/lib/server/map-research-geocode";
import {
  type ResearchedTargetWithGeocode,
  type ResolvedResearchCorridor,
  buildResearchedMapProposal,
} from "@/lib/map/researched-map-proposals";
```

Build the public outcome with an explicit `mapState` argument:

```ts
async function buildOutcomeFromModelOutput({
  mapState,
  request,
  output,
}: {
  mapState: MapState;
  request: Request;
  output: MapAssistantModelOutput;
}): Promise<MapAssistantOutcome> {
  if (output.kind === "needsMoreInfo" || output.kind === "noAction") {
    return output;
  }

  if (output.kind === "proposal") {
    return mapAssistantOutcomeSchema.parse(output);
  }

  const targetCandidates = output.targetCandidates.slice(0, MAX_MAP_RESEARCH_TARGET_CANDIDATES);
  const corridorCandidates = output.corridorCandidates.slice(0, MAX_MAP_RESEARCH_CORRIDOR_CANDIDATES);
  const geocodeQueries = collectResearchGeocodeQueries({ targetCandidates, corridorCandidates });
  const geocodeResults = await geocodeMapResearchQueries({ request, queries: geocodeQueries });
  const resolvedCorridors = await resolveResearchCorridors({
    corridorCandidates,
    geocodeResults: geocodeResults.results,
  });

  const built = buildResearchedMapProposal({
    mapState,
    targetCandidates: attachTargetGeocodes(targetCandidates, geocodeResults.results),
    corridorCandidates: resolvedCorridors,
    caveats: [...output.caveats, ...geocodeResults.caveats],
  });

  if (built.outcome.kind === "proposal") {
    return {
      ...built.outcome,
      assistantMessage: output.assistantMessage,
    };
  }

  return {
    ...built.outcome,
    assistantMessage: output.assistantMessage,
  };
}
```

Call the helper from `POST` like this after parsing the raw model output:

```ts
const outcome = await buildOutcomeFromModelOutput({
  mapState: body.mapState,
  request,
  output: parsedModelOutput,
});
const parsedOutcome = mapAssistantOutcomeSchema.parse(outcome);

return Response.json(parsedOutcome);
```

Collect Google geocode queries with stable IDs:

```ts
function collectResearchGeocodeQueries({
  targetCandidates,
  corridorCandidates,
}: {
  targetCandidates: ResearchTargetCandidate[];
  corridorCandidates: ResearchCorridorCandidate[];
}) {
  return [
    ...targetCandidates.map((candidate) => ({
      id: candidate.id,
      query: candidate.geocodeQuery,
    })),
    ...corridorCandidates.flatMap((candidate) =>
      candidate.orderedWaypoints.flatMap((waypoint, index) =>
        waypoint.geocodeQuery
          ? [
              {
                id: getWaypointGeocodeId(candidate.id, index),
                query: waypoint.geocodeQuery,
              },
            ]
          : [],
      ),
    ),
  ];
}

function getWaypointGeocodeId(candidateId: string, waypointIndex: number) {
  return `${candidateId}:waypoint:${waypointIndex}`;
}
```

Attach target geocode results by candidate ID:

```ts
function attachTargetGeocodes(
  targetCandidates: ResearchTargetCandidate[],
  geocodeResults: MapResearchGeocodeResult[],
): ResearchedTargetWithGeocode[] {
  const resultsById = new Map(geocodeResults.map((result) => [result.id, result.geocode]));

  return targetCandidates.map((candidate) => ({
    candidate,
    geocode: resultsById.get(candidate.id) ?? {
      status: "failed",
      error: "Geocode result was not returned.",
    },
  }));
}
```

Resolve corridors using official geometry first, then waypoint geometry, then approximate model lines:

```ts
async function resolveResearchCorridors({
  corridorCandidates,
  geocodeResults,
}: {
  corridorCandidates: ResearchCorridorCandidate[];
  geocodeResults: MapResearchGeocodeResult[];
}): Promise<ResolvedResearchCorridor[]> {
  const resultsById = new Map(geocodeResults.map((result) => [result.id, result.geocode]));
  const resolved: ResolvedResearchCorridor[] = [];

  for (const candidate of corridorCandidates) {
    if (candidate.officialGeometryUrl && candidate.requestedGeometryQuality === "official") {
      const officialGeometry = await resolveOfficialCorridorGeometry({
        url: candidate.officialGeometryUrl,
      });

      if (officialGeometry.status === "ok") {
        resolved.push({
          candidate,
          resolvedGeometryQuality: "official",
          geometry: officialGeometry.geometry,
        });
        continue;
      }
    }

    const waypointGeometry = buildWaypointGeometry({ candidate, resultsById });
    if (waypointGeometry) {
      resolved.push({
        candidate,
        resolvedGeometryQuality: "fromStops",
        geometry: waypointGeometry,
      });
      continue;
    }

    if (hasAtLeastTwoPoints(candidate.sourcedLineString)) {
      resolved.push({
        candidate,
        resolvedGeometryQuality: "approximate",
        geometry: candidate.sourcedLineString,
      });
      continue;
    }

    resolved.push({
      candidate,
      resolvedGeometryQuality: "approximate",
      geometry: null,
    });
  }

  return resolved;
}

function buildWaypointGeometry({
  candidate,
  resultsById,
}: {
  candidate: ResearchCorridorCandidate;
  resultsById: Map<string, MapResearchGeocodeResult["geocode"]>;
}): LineStringGeometry | null {
  const coordinates: Coordinate[] = candidate.orderedWaypoints.flatMap((waypoint, index) => {
    if (waypoint.coordinates) {
      return [waypoint.coordinates];
    }

    const geocode = resultsById.get(getWaypointGeocodeId(candidate.id, index));
    return geocode?.status === "ok" ? [geocode.coordinates] : [];
  });

  if (coordinates.length < 2) {
    return null;
  }

  return { type: "LineString", coordinates };
}

function hasAtLeastTwoPoints(lineString: LineStringGeometry | null) {
  return Boolean(lineString && lineString.coordinates.length >= 2);
}
```

- [ ] **Step 8: Update OpenAI request instructions**

Replace the developer message with:

```ts
content:
  "You are an SF apartment map planning assistant. You can use web search for real-world map research. Ask a follow-up question when the user has not provided enough information to make a high-confidence proposal. Propose map changes only; never claim changes were applied. For researched pins, return geocode queries and source evidence, not trusted final coordinates. For corridors, label geometry quality honestly: official only when a cited machine-readable geometry source exists, fromStops for ordered stops or waypoints, and approximate for model-drawn route lines. Every proposal requires user review.",
```

Include `conversationContext` in the user payload:

```ts
content: JSON.stringify({
  message: body.message,
  conversationContext: body.conversationContext ?? null,
  mapState: body.mapState,
  selectedZoneIds: body.selectedZoneIds ?? [],
  activeFilters: body.activeFilters ?? {},
}),
```

Set OpenAI tools without forcing search for every simple edit:

```ts
tools: [{ type: "web_search" }],
```

Do not set `tool_choice: "required"` in the map assistant route; ordinary local map edits should still work without forcing web research.

- [ ] **Step 9: Run route tests**

Run:

```bash
npm run test -- tests/routes/map-assistant-route.test.ts tests/unit/research-summary.test.ts tests/unit/researched-map-proposals.test.ts tests/unit/map-research-geocode.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

Run:

```bash
git status --short
git add app/api/ai/map-assistant/route.ts lib/domain/schemas.ts tests/routes/map-assistant-route.test.ts
git commit -m "Research map assistant responses"
```

Expected: one commit containing route integration and route tests.

## Task 5: Client Chat Outcomes And Review Metadata

**Files:**
- Create: `lib/storage/geocode-session-storage.ts`
- Modify: `components/apartment-map/apartment-map-app.tsx`
- Modify: `components/apartment-map/sidebar.tsx`
- Modify: `components/apartment-map/assistant-panel.tsx`
- Modify: `components/apartment-map/proposal-review-dialog.tsx`
- Test: `tests/e2e/apartment-map.spec.ts`

- [ ] **Step 1: Re-read client component docs**

Run:

```bash
sed -n '1,180p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
sed -n '1,180p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Expected: docs render locally. Keep storage access inside client-only code.

- [ ] **Step 2: Extract the geocode session storage wrapper**

Create `lib/storage/geocode-session-storage.ts`:

```ts
const GEOCODE_SESSION_STORAGE_KEY = "sf-apt-hunt:geocode-session:v1";

export function loadOrCreateGeocodeSessionId() {
  try {
    const existingSessionId = window.sessionStorage.getItem(GEOCODE_SESSION_STORAGE_KEY);
    if (existingSessionId) {
      return existingSessionId;
    }

    const nextSessionId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `session-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(GEOCODE_SESSION_STORAGE_KEY, nextSessionId);
    return nextSessionId;
  } catch {
    return "session-unavailable";
  }
}
```

In `components/apartment-map/apartment-map-app.tsx`, replace the local `getGeocodeSessionId` function with `loadOrCreateGeocodeSessionId()` for listing geocoding.

- [ ] **Step 3: Add proposal review state type**

In `lib/domain/types.ts`, add:

```ts
export type MapAssistantProposalReview = {
  proposal: MapPatchProposal;
  researchSummary: ResearchSummary;
};
```

In `components/apartment-map/apartment-map-app.tsx`, update:

```ts
const [proposal, setProposal] = useState<MapAssistantProposalReview | null>(null);
```

Update `Sidebar`, `AssistantPanel`, and `ProposalReviewDialog` prop types so:

```ts
onProposalChange: (proposal: MapAssistantProposalReview | null) => void;
proposal: MapAssistantProposalReview | null;
```

When applying a proposal, `ProposalReviewDialog` must continue sending only `proposal.proposal` to `/api/map/apply-proposal`:

```ts
body: JSON.stringify({ mapState, proposal: proposal.proposal }),
```

- [ ] **Step 4: Update assistant panel parsing**

In `components/apartment-map/assistant-panel.tsx`, import:

```ts
import { listingSearchResponseSchema, mapAssistantOutcomeSchema } from "@/lib/domain/schemas";
import { loadOrCreateGeocodeSessionId } from "@/lib/storage/geocode-session-storage";
import type { MapAssistantProposalReview } from "@/lib/domain/types";
```

Replace `readProposal` with:

```ts
function readMapAssistantOutcome(value: unknown) {
  const parsed = mapAssistantOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
```

Add pending clarification state:

```ts
const [pendingClarification, setPendingClarification] = useState<{
  originalMessage: string;
  assistantMessage: string;
  missingInformation: string[];
} | null>(null);
```

When sending a map request, include the session header and optional conversation context:

```ts
headers: {
  authorization: `Bearer ${apiKey}`,
  "content-type": "application/json",
  ...(requestKind === "map" ? { "x-sf-apt-session": loadOrCreateGeocodeSessionId() } : {}),
},
body: JSON.stringify(
  requestKind === "listing"
    ? {
        query: trimmedMessage,
        filters: listingRequest?.filters ?? activeFilters,
        selectedContext: buildSelectedContext(mapState, selectedZoneIds),
      }
    : {
        message: trimmedMessage,
        mapState,
        selectedZoneIds,
        activeFilters,
        conversationContext: pendingClarification
          ? { pendingClarification }
          : undefined,
      },
),
```

Handle map outcomes:

```ts
const outcome = readMapAssistantOutcome(body);
if (!outcome) {
  throw new Error("Map assistant returned an unexpected response.");
}

if (outcome.kind === "needsMoreInfo") {
  props.onProposalChange(null);
  setPendingClarification({
    originalMessage: trimmedMessage,
    assistantMessage: outcome.assistantMessage,
    missingInformation: outcome.missingInformation,
  });
  setStatus(outcome.assistantMessage);
  return;
}

setPendingClarification(null);

if (outcome.kind === "noAction") {
  props.onProposalChange(null);
  setStatus(outcome.assistantMessage);
  return;
}

const proposalReview: MapAssistantProposalReview = {
  proposal: outcome.proposal,
  researchSummary: outcome.researchSummary,
};
props.onProposalChange(proposalReview);
setStatus(outcome.assistantMessage);
```

- [ ] **Step 5: Render research metadata in proposal review**

In `components/apartment-map/proposal-review-dialog.tsx`, update operation rendering:

```ts
function findResearchItem(
  researchSummary: ResearchSummary,
  operation: ProposalOperation,
) {
  if (operation.type === "addTarget") {
    return researchSummary.items.find(
      (item) => item.operationType === "addTarget" && item.entityId === operation.target.id,
    );
  }

  if (operation.type === "addCorridor") {
    return researchSummary.items.find(
      (item) => item.operationType === "addCorridor" && item.entityId === operation.corridor.id,
    );
  }

  return null;
}
```

Under each operation preview, render metadata when present:

```tsx
{researchItem ? (
  <div className="mt-2 border border-border bg-muted/30 p-2 text-xs leading-5">
    <p className="font-medium">Research</p>
    <p>
      Source:{" "}
      <a
        className="underline underline-offset-2"
        href={researchItem.source.url}
        rel="noreferrer"
        target="_blank"
      >
        {researchItem.source.title ?? researchItem.source.sourceDomain}
      </a>
    </p>
    <p>Confidence: {researchItem.confidence}</p>
    {researchItem.geometryQuality ? <p>Geometry: {researchItem.geometryQuality}</p> : null}
    {researchItem.geocodePrecision ? <p>Geocode: {researchItem.geocodePrecision}</p> : null}
    {researchItem.caveats.length > 0 ? (
      <p>Caveats: {researchItem.caveats.join(" / ")}</p>
    ) : null}
  </div>
) : null}
```

After the operations list, render exclusions when present:

```tsx
{proposal.researchSummary.exclusions.length > 0 ? (
  <div className="mt-3 border border-border bg-muted/30 p-2 text-xs leading-5">
    <p className="font-medium">Excluded researched results</p>
    <ul className="mt-1 space-y-1">
      {proposal.researchSummary.exclusions.map((exclusion, index) => (
        <li key={`${exclusion.label}-${index}`}>
          {exclusion.label}: {exclusion.reason}
          {exclusion.caveats.length > 0 ? ` - ${exclusion.caveats.join(" / ")}` : ""}
        </li>
      ))}
    </ul>
  </div>
) : null}
```

Use compact text and existing border/background tokens. Do not add a full research-results browser.

- [ ] **Step 6: Add E2E tests for chat outcomes and review metadata**

Update `tests/e2e/apartment-map.spec.ts` with route mocks:

```ts
test("map assistant shows sourced researched pins in proposal review", async ({ page }) => {
  await page.route("**/api/ai/map-assistant", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "proposal",
        assistantMessage: "I found one researched target for review.",
        proposal: {
          summary: "Add researched fitness target.",
          operations: [
            {
              type: "addTarget",
              target: {
                id: "otf-fi-di",
                name: "Orangetheory Fitness Financial District",
                purpose: "fitness anchor",
                coordinates: [-122.401, 37.792],
                priority: "high",
                influence: "positive",
                radiusMinutes: 10,
                notes: ["Source-backed studio location."],
              },
            },
          ],
          confidence: "high",
          requiresUserReview: true,
        },
        researchSummary: {
          items: [
            {
              entityId: "otf-fi-di",
              operationType: "addTarget",
              label: "Orangetheory Fitness Financial District",
              source: {
                url: "https://www.orangetheory.com/en-us/locations/california/san-francisco/financial-district",
                title: "Orangetheory Financial District",
                sourceDomain: "orangetheory.com",
              },
              confidence: "high",
              geocodePrecision: "exact",
              caveats: [],
            },
          ],
          exclusions: [],
          caveats: [],
        },
      }),
    });
  });

  await fillOpenAiKey(page);
  await page.getByLabel("Ask the assistant").fill("Create pins for Orange Theory locations in SF.");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByText("I found one researched target for review.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review proposed map changes" })).toBeVisible();
  await expect(page.getByText("Source:")).toBeVisible();
  await expect(page.getByRole("link", { name: "Orangetheory Financial District" })).toBeVisible();
  await expect(page.getByText("Geocode: exact")).toBeVisible();
});
```

Add two more E2E tests:

```ts
test("map assistant follow-up outcome displays as chat status without opening proposal review", async ({ page }) => {
  const mapRequests: unknown[] = [];
  let requestCount = 0;
  await page.route("**/api/ai/map-assistant", async (route) => {
    mapRequests.push(route.request().postDataJSON());
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        requestCount === 1
          ? {
              kind: "needsMoreInfo",
              assistantMessage: "Do you want pins, corridors, or both?",
              missingInformation: ["object to create"],
            }
          : {
              kind: "noAction",
              assistantMessage: "I need a specific place type before creating map objects.",
              caveats: ["The follow-up answer still did not name what to find."],
            },
      ),
    });
  });

  await fillOpenAiKey(page);
  await page.getByLabel("Ask the assistant").fill("Map useful things in SF.");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByText("Do you want pins, corridors, or both?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review proposed map changes" })).toHaveCount(0);

  await page.getByLabel("Ask the assistant").fill("Pins.");
  await page.getByRole("button", { name: /send/i }).click();

  expect(mapRequests[1]).toMatchObject({
    message: "Pins.",
    conversationContext: {
      pendingClarification: {
        originalMessage: "Map useful things in SF.",
        assistantMessage: "Do you want pins, corridors, or both?",
        missingInformation: ["object to create"],
      },
    },
  });
});

test("map assistant noAction outcome displays as chat status without an error", async ({ page }) => {
  await page.route("**/api/ai/map-assistant", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "noAction",
        assistantMessage: "I could not verify a sourced SF map change.",
        caveats: ["No matching source was found."],
      }),
    });
  });

  await fillOpenAiKey(page);
  await page.getByLabel("Ask the assistant").fill("Map the imaginary tunnel route.");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByText("I could not verify a sourced SF map change.")).toBeVisible();
  await expect(page.getByText("The map assistant could not create a proposal.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review proposed map changes" })).toHaveCount(0);
});
```

- [ ] **Step 7: Run focused E2E test**

Run:

```bash
npm run test:e2e -- tests/e2e/apartment-map.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git status --short
git add lib/domain/types.ts lib/storage/geocode-session-storage.ts components/apartment-map/apartment-map-app.tsx components/apartment-map/sidebar.tsx components/apartment-map/assistant-panel.tsx components/apartment-map/proposal-review-dialog.tsx tests/e2e/apartment-map.spec.ts
git commit -m "Show researched map assistant outcomes"
```

Expected: one commit containing client integration and E2E coverage.

## Task 6: Final Verification And Polish

**Files:**
- Modify only files touched by previous tasks if verification exposes failures.

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run unit and route tests**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 4: Run E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Manual browser smoke test**

Start the dev server:

```bash
npm run dev
```

Open `http://localhost:3333` in the in-app Browser. Verify:

- A researched target proposal displays source, confidence, and geocode precision in review.
- A researched corridor proposal displays source, confidence, and geometry quality in review.
- `needsMoreInfo` shows assistant text and does not open review.
- `noAction` shows assistant text and does not display a failed-request error.
- Applying a proposal sends only the `MapPatchProposal` to `/api/map/apply-proposal`.

- [ ] **Step 7: Commit any verification fixes**

If verification required fixes, run:

```bash
git status --short
git add lib/domain/types.ts lib/domain/schemas.ts lib/map/research-summary.ts lib/map/researched-map-proposals.ts lib/server/map-research-geocode.ts lib/server/research-geometry-source.ts lib/storage/geocode-session-storage.ts app/api/ai/map-assistant/route.ts components/apartment-map/apartment-map-app.tsx components/apartment-map/sidebar.tsx components/apartment-map/assistant-panel.tsx components/apartment-map/proposal-review-dialog.tsx tests/unit/research-summary.test.ts tests/unit/researched-map-proposals.test.ts tests/unit/map-research-geocode.test.ts tests/routes/map-assistant-route.test.ts tests/e2e/apartment-map.spec.ts
git commit -m "Fix researched map assistant verification"
```

Expected: no commit if all verification passed without edits.

- [ ] **Step 8: Prepare branch for review**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: no unstaged changes from this implementation except unrelated user changes that existed before the work. The implementation commits should be clearly scoped and ready for review or squash merge.
