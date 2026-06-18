import { createHash } from "node:crypto";

import { z } from "zod";

import {
  mapAssistantOutcomeSchema,
  mapPatchProposalSchema,
  mapStateSchema,
  researchedCorridorCandidatesSchema,
  researchedTargetCandidatesSchema,
} from "@/lib/domain/schemas";
import type {
  Coordinate,
  LineStringGeometry,
  MapAssistantOutcome,
  MapPatchProposal,
  MapState,
  ResearchExclusion,
  ResearchSummary,
  ResearchSummaryItem,
  ResearchedCorridorCandidate,
  ResearchedTargetCandidate,
} from "@/lib/domain/types";
import {
  createUniqueResearchEntityId,
  dedupeResearchedCorridorCandidates,
  dedupeResearchedTargetCandidates,
} from "@/lib/map/researched-candidates";
import { isLineStringInSfBounds } from "@/lib/map/sf-bounds";
import { geocodeListingLocation } from "@/lib/server/google-geocode";
import {
  createOpenAiResponse,
  extractOutputText,
  getOpenAiKeyFromRequest,
} from "@/lib/server/openai";
import { checkFixedWindowRateLimit, createRedisFromEnv } from "@/lib/server/rate-limit";
import { redactSecrets } from "@/lib/server/redaction";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_MAP_ASSISTANT_REQUEST_BYTES = 256 * 1024;
const MAX_MAP_RESEARCH_GEOCODE_ATTEMPTS = 25;
const MAP_RESEARCH_GEOCODE_RATE_LIMIT = 50;
const MAP_RESEARCH_GEOCODE_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

const mapAssistantRequestSchema = z
  .object({
    message: z.string().min(1).max(4_000),
    mapState: mapStateSchema,
    selectedZoneIds: z.array(z.string().min(1).max(128)).max(100).optional(),
    activeFilters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const legacyMapAssistantResponseSchema = z
  .object({
    explanation: z.string().min(1).max(4_000),
    intent: z.enum(["map_edit", "prioritization", "comparison", "listing_search", "unknown"]),
    proposal: mapPatchProposalSchema.nullable(),
    confidence: z.enum(["low", "medium", "high"]),
    caveats: z.array(z.string().max(2_000)).max(50),
  })
  .strict();

const openAiMapAssistantResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("needsMoreInfo"),
      assistantMessage: z.string().min(1).max(4_000),
      missingInformation: z.array(z.string().min(1).max(2_000)).min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("noAction"),
      assistantMessage: z.string().min(1).max(4_000),
      caveats: z.array(z.string().max(2_000)).max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("proposal"),
      assistantMessage: z.string().min(1).max(4_000),
      proposal: mapPatchProposalSchema,
      targetCandidates: researchedTargetCandidatesSchema,
      corridorCandidates: researchedCorridorCandidatesSchema,
      caveats: z.array(z.string().max(2_000)).max(50),
    })
    .strict(),
]);

type OpenAiMapAssistantResponse = z.infer<typeof openAiMapAssistantResponseSchema>;
type ResearchGeocodeContext = {
  apiKey: string | null;
  redis: ReturnType<typeof createRedisFromEnv>;
  request: Request;
  attempts: number;
};

type ResearchGeocodeResult =
  | {
      status: "ok";
      coordinates: Coordinate;
      geocodePrecision: "exact" | "approximate";
      formattedAddress: string;
    }
  | {
      status: "failed" | "outside_sf" | "over_cap";
      error: string;
    };

type EnrichedTargetCandidate = {
  candidate: ResearchedTargetCandidate;
  coordinates: Coordinate;
  geocodePrecision: "exact" | "approximate";
  formattedAddress: string;
};

type EnrichedCorridorCandidate = {
  candidate: ResearchedCorridorCandidate;
  geometry: LineStringGeometry;
  geometryQuality: "fromStops" | "approximate";
  caveats: string[];
};

type EnrichCorridorCandidateResult =
  | { ok: true; item: EnrichedCorridorCandidate }
  | { ok: false; reason: ResearchExclusion["reason"]; caveats: string[] };

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);

  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = mapAssistantRequestSchema.parse(
      await readJsonRequestBody(request, MAX_MAP_ASSISTANT_REQUEST_BYTES),
    );
    const openAiResponse = await createOpenAiResponse({
      apiKey,
      payload: {
        model: process.env.OPENAI_MODEL ?? "gpt-5.5",
        store: false,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "developer",
            content:
              "You are an SF apartment map planning assistant. Return only structured JSON. " +
              "Your goal is to gather enough relevant information to make high-confidence, reviewable map changes. " +
              "Ask for more information when the user's request is underspecified. Return noAction when no safe map change is warranted. " +
              "Use web search for current real-world places, businesses, amenities, transit routes, or route geometry. " +
              "For researched pins, never provide trusted coordinates; return targetCandidates with geocodeQuery values for server geocoding. " +
              "For researched corridors, prefer ordered waypoints or an honest approximate modelLineString with caveats unless a source URL directly provides parseable geometry. " +
              "Use proposal operations for edits to existing map entities and leave targetCandidates/corridorCandidates empty when no outside research is needed. " +
              "Every proposal must require user review and must not claim changes were applied. Coordinates use [longitude, latitude].",
          },
          {
            role: "user",
            content: JSON.stringify({
              message: body.message,
              mapState: body.mapState,
              selectedZoneIds: body.selectedZoneIds ?? [],
              activeFilters: body.activeFilters ?? {},
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "map_patch_assistant_response",
            strict: true,
            schema: openAiMapAssistantJsonSchema,
          },
        },
      },
    });

    if (!openAiResponse.ok) {
      return Response.json(
        {
          ok: false,
          error: "OpenAI request failed.",
          details: redactSecrets(openAiResponse.body),
        },
        { status: openAiResponse.status },
      );
    }

    const outputText = extractOutputText(openAiResponse.body);

    if (!outputText) {
      return Response.json(
        { ok: false, error: "Missing structured output." },
        { status: 502 },
      );
    }

    const parsedOutput = normalizeMapAssistantResponse(JSON.parse(outputText));
    const parsedResponse = await buildMapAssistantOutcome({
      modelResponse: parseOpenAiMapAssistantResponse(parsedOutput),
      request,
      mapState: body.mapState,
    });

    return Response.json(mapAssistantOutcomeSchema.parse(parsedResponse));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Map assistant request is too large." },
        { status: 413 },
      );
    }

    return Response.json(
      {
        ok: false,
        error: "Invalid map assistant request.",
        details: redactSecrets(getErrorDetails(error)),
      },
      { status: 400 },
    );
  }
}

function getErrorDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return error;
}

function parseOpenAiMapAssistantResponse(value: unknown): OpenAiMapAssistantResponse {
  const parsed = openAiMapAssistantResponseSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const legacyParsed = legacyMapAssistantResponseSchema.safeParse(value);
  if (legacyParsed.success) {
    if (!legacyParsed.data.proposal) {
      return {
        kind: "noAction",
        assistantMessage: legacyParsed.data.explanation,
        caveats: legacyParsed.data.caveats,
      };
    }

    return {
      kind: "proposal",
      assistantMessage: legacyParsed.data.explanation,
      proposal: legacyParsed.data.proposal,
      targetCandidates: [],
      corridorCandidates: [],
      caveats: legacyParsed.data.caveats,
    };
  }

  return openAiMapAssistantResponseSchema.parse(value);
}

async function buildMapAssistantOutcome({
  modelResponse,
  request,
  mapState,
}: {
  modelResponse: OpenAiMapAssistantResponse;
  request: Request;
  mapState: MapState;
}): Promise<MapAssistantOutcome> {
  if (modelResponse.kind !== "proposal") {
    return modelResponse;
  }

  const researchSummary: ResearchSummary = {
    items: [],
    exclusions: [],
    caveats: [...modelResponse.caveats],
  };
  const geocodeContext: ResearchGeocodeContext = {
    apiKey: process.env.GOOGLE_MAPS_API_KEY ?? null,
    redis: createRedisFromEnv(),
    request,
    attempts: 0,
  };
  const researchedOperations: MapPatchProposal["operations"] = [];

  const researchedTargets = await buildResearchedTargetOperations({
    candidates: modelResponse.targetCandidates,
    geocodeContext,
    mapState,
  });
  researchedOperations.push(...researchedTargets.operations);
  researchSummary.items.push(...researchedTargets.items);
  researchSummary.exclusions.push(...researchedTargets.exclusions);
  researchSummary.caveats.push(...researchedTargets.caveats);

  const mapStateWithResearchedTargets: MapState = {
    ...mapState,
    targets: [
      ...mapState.targets,
      ...researchedTargets.operations
        .filter((operation) => operation.type === "addTarget")
        .map((operation) => operation.target),
    ],
  };

  const researchedCorridors = await buildResearchedCorridorOperations({
    candidates: modelResponse.corridorCandidates,
    geocodeContext,
    mapState: mapStateWithResearchedTargets,
  });
  researchedOperations.push(...researchedCorridors.operations);
  researchSummary.items.push(...researchedCorridors.items);
  researchSummary.exclusions.push(...researchedCorridors.exclusions);
  researchSummary.caveats.push(...researchedCorridors.caveats);

  const proposal: MapPatchProposal = {
    ...modelResponse.proposal,
    operations: [...modelResponse.proposal.operations, ...researchedOperations],
  };

  if (proposal.operations.length === 0) {
    return {
      kind: "noAction",
      assistantMessage:
        researchSummary.exclusions.length > 0
          ? "I found possible map items, but none passed validation."
          : modelResponse.assistantMessage,
      caveats: [
        ...researchSummary.caveats,
        ...researchSummary.exclusions.flatMap((exclusion) => exclusion.caveats),
      ].slice(0, 50),
    };
  }

  return {
    kind: "proposal",
    assistantMessage: modelResponse.assistantMessage,
    proposal,
    researchSummary,
  };
}

async function buildResearchedTargetOperations({
  candidates,
  geocodeContext,
  mapState,
}: {
  candidates: ResearchedTargetCandidate[];
  geocodeContext: ResearchGeocodeContext;
  mapState: MapState;
}) {
  const geocodedCandidates: EnrichedTargetCandidate[] = [];
  const exclusions: ResearchExclusion[] = [];
  const caveats: string[] = [];

  for (const candidate of candidates) {
    const geocode = await geocodeResearchQuery({
      context: geocodeContext,
      query: candidate.geocodeQuery,
    });

    if (geocode.status !== "ok") {
      exclusions.push({
        label: candidate.name,
        reason: geocode.status === "over_cap" ? "over_cap" : "geocode_failed",
        source: candidate.source,
        caveats: [geocode.error],
      });
      continue;
    }

    geocodedCandidates.push({
      candidate,
      coordinates: geocode.coordinates,
      geocodePrecision: geocode.geocodePrecision,
      formattedAddress: geocode.formattedAddress,
    });
  }

  const deduped = dedupeResearchedTargetCandidates({
    mapState,
    candidates: geocodedCandidates,
  });
  exclusions.push(...deduped.exclusions);

  const operations: MapPatchProposal["operations"] = [];
  const items: ResearchSummaryItem[] = [];
  const existingIds = collectMapEntityIds(mapState);

  for (const item of deduped.accepted) {
    const targetId = createUniqueResearchEntityId({
      candidateId: item.candidate.id,
      candidateName: item.candidate.name,
      existingIds,
      prefix: "target",
    });
    existingIds.add(targetId);

    operations.push({
      type: "addTarget",
      target: {
        id: targetId,
        name: item.candidate.name,
        purpose: item.candidate.purpose,
        coordinates: item.coordinates,
        priority: item.candidate.priority,
        influence: item.candidate.influence,
        radiusMinutes: item.candidate.radiusMinutes,
        notes: [
          item.candidate.address ?? item.formattedAddress,
          ...item.candidate.caveats,
        ].slice(0, 50),
      },
    });
    items.push({
      entityId: targetId,
      operationType: "addTarget",
      label: item.candidate.name,
      source: item.candidate.source,
      confidence: item.candidate.confidence,
      geocodePrecision: item.geocodePrecision,
      caveats: item.candidate.caveats,
    });
  }

  return { operations, items, exclusions, caveats };
}

async function buildResearchedCorridorOperations({
  candidates,
  geocodeContext,
  mapState,
}: {
  candidates: ResearchedCorridorCandidate[];
  geocodeContext: ResearchGeocodeContext;
  mapState: MapState;
}) {
  const enrichedCandidates: EnrichedCorridorCandidate[] = [];
  const exclusions: ResearchExclusion[] = [];
  const caveats: string[] = [];

  for (const candidate of candidates) {
    const enriched = await enrichCorridorCandidate({ candidate, geocodeContext });

    if (!enriched.ok) {
      exclusions.push({
        label: candidate.name,
        reason: enriched.reason,
        source: candidate.source,
        caveats: enriched.caveats,
      });
      continue;
    }

    if (!isLineStringInSfBounds(enriched.item.geometry)) {
      exclusions.push({
        label: candidate.name,
        reason: "out_of_bounds",
        source: candidate.source,
        caveats: ["The researched corridor geometry falls outside San Francisco bounds."],
      });
      continue;
    }

    enrichedCandidates.push(enriched.item);
  }

  const deduped = dedupeResearchedCorridorCandidates({
    mapState,
    candidates: enrichedCandidates,
  });
  exclusions.push(...deduped.exclusions);

  const operations: MapPatchProposal["operations"] = [];
  const items: ResearchSummaryItem[] = [];
  const existingIds = collectMapEntityIds(mapState);

  for (const item of deduped.accepted) {
    const corridorId = createUniqueResearchEntityId({
      candidateId: item.candidate.id,
      candidateName: item.candidate.name,
      existingIds,
      prefix: "corridor",
    });
    existingIds.add(corridorId);

    operations.push({
      type: "addCorridor",
      corridor: {
        id: corridorId,
        name: item.candidate.name,
        geometry: item.geometry,
        priority: item.candidate.priority,
        tags: item.candidate.tags,
        notes: [...item.candidate.notes, ...item.caveats].slice(0, 50),
      },
    });
    items.push({
      entityId: corridorId,
      operationType: "addCorridor",
      label: item.candidate.name,
      source: item.candidate.source,
      confidence: item.candidate.confidence,
      geometryQuality: item.geometryQuality,
      caveats: [...item.candidate.caveats, ...item.caveats],
    });
  }

  return { operations, items, exclusions, caveats };
}

async function enrichCorridorCandidate({
  candidate,
  geocodeContext,
}: {
  candidate: ResearchedCorridorCandidate;
  geocodeContext: ResearchGeocodeContext;
}): Promise<EnrichCorridorCandidateResult> {
  if (candidate.geometry.kind === "modelLineString") {
    return {
      ok: true,
      item: {
        candidate,
        geometry: {
          type: "LineString",
          coordinates: candidate.geometry.coordinates,
        },
        geometryQuality: "approximate",
        caveats: [candidate.geometry.caveat, ...candidate.caveats],
      },
    };
  }

  if (candidate.geometry.kind === "sourceUrl") {
    return {
      ok: false,
      reason: "invalid_geometry",
      caveats: ["Official source geometry fetching is not implemented for this source yet."],
    };
  }

  const coordinates: Coordinate[] = [];
  const caveats: string[] = [];

  for (const waypoint of candidate.geometry.waypoints) {
    const geocode = await geocodeResearchQuery({
      context: geocodeContext,
      query: waypoint.geocodeQuery,
    });

    if (geocode.status !== "ok") {
      caveats.push(`${waypoint.label}: ${geocode.error}`);
      return {
        ok: false,
        reason: geocode.status === "over_cap"
          ? "over_cap"
          : geocode.status === "outside_sf"
            ? "out_of_bounds"
            : "geocode_failed",
        caveats,
      };
    }

    coordinates.push(geocode.coordinates);
  }

  return {
    ok: true,
    item: {
      candidate,
      geometry: { type: "LineString", coordinates },
      geometryQuality: "fromStops",
      caveats,
    },
  };
}

async function geocodeResearchQuery({
  context,
  query,
}: {
  context: ResearchGeocodeContext;
  query: string;
}): Promise<ResearchGeocodeResult> {
  if (!context.apiKey) {
    return { status: "failed", error: "Geocoding is not configured." };
  }

  if (context.attempts >= MAX_MAP_RESEARCH_GEOCODE_ATTEMPTS) {
    return { status: "over_cap", error: "Research geocoding exceeded the per-request cap." };
  }

  const quota = await chargeResearchGeocodeQuota(context);
  if (!quota.ok) {
    return { status: "over_cap", error: quota.error };
  }

  context.attempts += 1;
  const geocode = await geocodeListingLocation({
    apiKey: context.apiKey,
    query,
  });

  if (geocode.status !== "ok") {
    return { status: geocode.status, error: geocode.error };
  }

  return {
    status: "ok",
    coordinates: geocode.coordinates,
    geocodePrecision: geocode.markerPrecision,
    formattedAddress: geocode.formattedAddress,
  };
}

async function chargeResearchGeocodeQuota(context: ResearchGeocodeContext) {
  if (!context.redis) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false as const, error: "Rate limiting is not configured." };
    }

    return { ok: true as const };
  }

  const session = getClientSession(context.request);
  if (!session && process.env.NODE_ENV === "production") {
    return {
      ok: false as const,
      error: "Research geocoding session identity is missing.",
    };
  }

  const checks = await Promise.all([
    checkFixedWindowRateLimit({
      redis: context.redis,
      key: getIpRateLimitKey(context.request),
      limit: MAP_RESEARCH_GEOCODE_RATE_LIMIT,
      windowSeconds: MAP_RESEARCH_GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
    }),
    checkFixedWindowRateLimit({
      redis: context.redis,
      key: getSessionRateLimitKey(session ?? "development-session"),
      limit: MAP_RESEARCH_GEOCODE_RATE_LIMIT,
      windowSeconds: MAP_RESEARCH_GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
    }),
  ]);

  if (checks.some((check) => !check.ok)) {
    return { ok: false as const, error: "Research geocoding rate limit exceeded." };
  }

  return { ok: true as const };
}

function collectMapEntityIds(mapState: MapState) {
  return new Set([
    ...mapState.zones.map((zone) => zone.id),
    ...mapState.corridors.map((corridor) => corridor.id),
    ...mapState.targets.map((target) => target.id),
  ]);
}

function getIpRateLimitKey(request: Request) {
  return `geocode:map-research:ip:${hashValue(getClientIp(request))}`;
}

function getSessionRateLimitKey(session: string) {
  return `geocode:map-research:session:${hashValue(session)}`;
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown-ip";
  return forwardedFor.split(",")[0]?.trim() || "unknown-ip";
}

function getClientSession(request: Request) {
  return request.headers.get("x-sf-apt-session")?.trim() || null;
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// OpenAI strict json_schema requires every property in `required`, so nullable
// proposal fields are declared required-and-nullable in the JSON schema. The
// Zod domain schema instead treats absent fields as "no change" (`.optional()`).
// This bridges the two by dropping model-supplied `null`s back to absent before
// Zod validation. See the "keep three representations in sync" note in
// AGENTS.md.
function normalizeMapAssistantResponse(value: unknown) {
  if (!isRecord(value) || !isRecord(value.proposal) || !Array.isArray(value.proposal.operations)) {
    return value;
  }

  return {
    ...value,
    proposal: {
      ...value.proposal,
      operations: value.proposal.operations.map(normalizeMapPatchOperation),
    },
  };
}

function normalizeMapPatchOperation(operation: unknown) {
  if (!isRecord(operation)) {
    return operation;
  }

  if (operation.type === "updateZoneScores") {
    return omitNullFields(operation, ["fitnessScore", "affordabilityScore", "carFreeScore"]);
  }

  if (operation.type === "updateTargetPlanningFields") {
    return omitNullFields(operation, [
      "name",
      "purpose",
      "influence",
      "priority",
      "radiusMinutes",
      "notes",
    ]);
  }

  return operation;
}

function omitNullFields<TField extends string>(
  operation: Record<string, unknown>,
  fields: readonly TField[],
) {
  const normalizedOperation = { ...operation };

  for (const field of fields) {
    if (normalizedOperation[field] === null) {
      delete normalizedOperation[field];
    }
  }

  return normalizedOperation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const scoreJsonSchema = { enum: [1, 2, 3, 4, 5] };
const nullableScoreJsonSchema = { anyOf: [scoreJsonSchema, { type: "null" }] };
const priorityJsonSchema = { enum: ["high", "medium", "low"] };
const nullableTextJsonSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 2000 }, { type: "null" }],
};
const nullableNameJsonSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 160 }, { type: "null" }],
};
const targetInfluenceJsonSchema = { enum: ["positive", "negative", "neutral"] };
const nullableTargetInfluenceJsonSchema = {
  anyOf: [targetInfluenceJsonSchema, { type: "null" }],
};
const targetRadiusMinutesJsonSchema = { enum: [5, 10, 15, 20] };
const nullableTargetRadiusMinutesJsonSchema = {
  anyOf: [targetRadiusMinutesJsonSchema, { type: "null" }],
};
const nullablePriorityJsonSchema = {
  anyOf: [priorityJsonSchema, { type: "null" }],
};
const sourceCitationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url", "title", "sourceDomain"],
  properties: {
    url: { type: "string", maxLength: 2048 },
    title: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
    sourceDomain: { type: "string", minLength: 1, maxLength: 128 },
  },
};
const coordinateJsonSchema = {
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: { type: "number" },
};
const textArrayJsonSchema = {
  type: "array",
  maxItems: 50,
  items: { type: "string", maxLength: 2000 },
};
const nullableTextArrayJsonSchema = {
  anyOf: [textArrayJsonSchema, { type: "null" }],
};
const targetPointJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "purpose",
    "coordinates",
    "priority",
    "influence",
    "radiusMinutes",
    "notes",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    purpose: { type: "string", minLength: 1, maxLength: 2000 },
    coordinates: coordinateJsonSchema,
    priority: priorityJsonSchema,
    influence: targetInfluenceJsonSchema,
    radiusMinutes: targetRadiusMinutesJsonSchema,
    notes: textArrayJsonSchema,
  },
};
const lineStringJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "coordinates"],
  properties: {
    type: { const: "LineString" },
    coordinates: {
      type: "array",
      minItems: 2,
      maxItems: 200,
      items: coordinateJsonSchema,
    },
  },
};
const polygonJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "coordinates"],
  properties: {
    type: { const: "Polygon" },
    coordinates: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "array",
        minItems: 4,
        maxItems: 200,
        items: coordinateJsonSchema,
      },
    },
  },
};
const targetCorridorJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "geometry", "priority", "tags", "notes"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    geometry: lineStringJsonSchema,
    priority: priorityJsonSchema,
    tags: {
      type: "array",
      maxItems: 5,
      items: { enum: ["fitness", "rent", "transit", "safety", "short-term"] },
    },
    notes: textArrayJsonSchema,
  },
};
const researchedTargetCandidateJsonSchema = {
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
    "confidence",
    "caveats",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    address: { anyOf: [{ type: "string", minLength: 1, maxLength: 2000 }, { type: "null" }] },
    geocodeQuery: { type: "string", minLength: 1, maxLength: 2000 },
    source: sourceCitationJsonSchema,
    purpose: { type: "string", minLength: 1, maxLength: 2000 },
    influence: targetInfluenceJsonSchema,
    priority: priorityJsonSchema,
    radiusMinutes: targetRadiusMinutesJsonSchema,
    confidence: { enum: ["high", "medium", "low"] },
    caveats: textArrayJsonSchema,
  },
};
const researchedCorridorCandidateJsonSchema = {
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
    "geometry",
    "caveats",
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    source: sourceCitationJsonSchema,
    priority: priorityJsonSchema,
    tags: {
      type: "array",
      maxItems: 5,
      items: { enum: ["fitness", "rent", "transit", "safety", "short-term"] },
    },
    notes: textArrayJsonSchema,
    confidence: { enum: ["high", "medium", "low"] },
    requestedGeometryQuality: { enum: ["official", "fromStops", "approximate"] },
    geometry: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "url", "format"],
          properties: {
            kind: { const: "sourceUrl" },
            url: { type: "string", maxLength: 2048 },
            format: { enum: ["gtfs", "geojson", "kml", "polyline", "unknown"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "waypoints"],
          properties: {
            kind: { const: "orderedWaypoints" },
            waypoints: {
              type: "array",
              minItems: 2,
              maxItems: 25,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "geocodeQuery"],
                properties: {
                  label: { type: "string", minLength: 1, maxLength: 160 },
                  geocodeQuery: { type: "string", minLength: 1, maxLength: 2000 },
                },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "coordinates", "caveat"],
          properties: {
            kind: { const: "modelLineString" },
            coordinates: {
              type: "array",
              minItems: 2,
              maxItems: 200,
              items: coordinateJsonSchema,
            },
            caveat: { type: "string", minLength: 1, maxLength: 2000 },
          },
        },
      ],
    },
    caveats: textArrayJsonSchema,
  },
};
const mapPatchProposalJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "operations", "confidence", "requiresUserReview"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    operations: {
      type: "array",
      maxItems: 50,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "target"],
            properties: {
              type: { const: "addTarget" },
              target: targetPointJsonSchema,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "corridor"],
            properties: {
              type: { const: "addCorridor" },
              corridor: targetCorridorJsonSchema,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "corridorId", "priority", "reason"],
            properties: {
              type: { const: "updateCorridorPriority" },
              corridorId: { type: "string", minLength: 1, maxLength: 128 },
              priority: priorityJsonSchema,
              reason: { type: "string", minLength: 1, maxLength: 2000 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "targetId", "priority", "reason"],
            properties: {
              type: { const: "updateTargetPriority" },
              targetId: { type: "string", minLength: 1, maxLength: 128 },
              priority: priorityJsonSchema,
              reason: { type: "string", minLength: 1, maxLength: 2000 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "type",
              "targetId",
              "name",
              "purpose",
              "influence",
              "priority",
              "radiusMinutes",
              "notes",
              "reason",
            ],
            properties: {
              type: { const: "updateTargetPlanningFields" },
              targetId: { type: "string", minLength: 1, maxLength: 128 },
              name: nullableNameJsonSchema,
              purpose: nullableTextJsonSchema,
              influence: nullableTargetInfluenceJsonSchema,
              priority: nullablePriorityJsonSchema,
              radiusMinutes: nullableTargetRadiusMinutesJsonSchema,
              notes: nullableTextArrayJsonSchema,
              reason: { type: "string", minLength: 1, maxLength: 2000 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "type",
              "zoneId",
              "fitnessScore",
              "affordabilityScore",
              "carFreeScore",
            ],
            properties: {
              type: { const: "updateZoneScores" },
              zoneId: { type: "string", minLength: 1, maxLength: 128 },
              fitnessScore: nullableScoreJsonSchema,
              affordabilityScore: nullableScoreJsonSchema,
              carFreeScore: nullableScoreJsonSchema,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "zoneId", "geometry", "reason"],
            properties: {
              type: { const: "replaceZoneGeometry" },
              zoneId: { type: "string", minLength: 1, maxLength: 128 },
              geometry: polygonJsonSchema,
              reason: { type: "string", minLength: 1, maxLength: 2000 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "entityId", "note"],
            properties: {
              type: { const: "addNote" },
              entityId: { type: "string", minLength: 1, maxLength: 128 },
              note: { type: "string", minLength: 1, maxLength: 2000 },
            },
          },
        ],
      },
    },
    confidence: { enum: ["low", "medium", "high"] },
    requiresUserReview: { const: true },
  },
};
const openAiMapAssistantJsonSchema = {
  anyOf: [
    {
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
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "assistantMessage", "proposal", "targetCandidates", "corridorCandidates", "caveats"],
      properties: {
        kind: { const: "proposal" },
        assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
        proposal: mapPatchProposalJsonSchema,
        targetCandidates: {
          type: "array",
          maxItems: 20,
          items: researchedTargetCandidateJsonSchema,
        },
        corridorCandidates: {
          type: "array",
          maxItems: 5,
          items: researchedCorridorCandidateJsonSchema,
        },
        caveats: {
          type: "array",
          maxItems: 50,
          items: { type: "string", maxLength: 2000 },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "assistantMessage", "caveats"],
      properties: {
        kind: { const: "noAction" },
        assistantMessage: { type: "string", minLength: 1, maxLength: 4000 },
        caveats: {
          type: "array",
          maxItems: 50,
          items: { type: "string", maxLength: 2000 },
        },
      },
    },
  ],
};
