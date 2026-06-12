import { z } from "zod";

import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import {
  createOpenAiResponse,
  extractOutputText,
  getOpenAiKeyFromRequest,
} from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_MAP_ASSISTANT_REQUEST_BYTES = 256 * 1024;

const mapAssistantRequestSchema = z
  .object({
    message: z.string().min(1).max(4_000),
    mapState: mapStateSchema,
    selectedZoneIds: z.array(z.string().min(1).max(128)).max(100).optional(),
    activeFilters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const mapAssistantResponseSchema = z
  .object({
    explanation: z.string().min(1).max(4_000),
    intent: z.enum(["map_edit", "prioritization", "comparison", "listing_search", "unknown"]),
    proposal: mapPatchProposalSchema.nullable(),
    confidence: z.enum(["low", "medium", "high"]),
    caveats: z.array(z.string().max(2_000)).max(50),
  })
  .strict();

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
        input: [
          {
            role: "developer",
            content:
              "You are an SF apartment map planning assistant. Propose map changes only; never claim that changes were applied. Every proposal must require user review, and a null proposal is valid when no safe map change is warranted.",
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
            schema: mapAssistantJsonSchema,
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
    const parsedResponse = mapAssistantResponseSchema.parse(parsedOutput);

    return Response.json(parsedResponse);
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
const mapAssistantJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["explanation", "intent", "proposal", "confidence", "caveats"],
  properties: {
    explanation: { type: "string", minLength: 1, maxLength: 4000 },
    intent: { enum: ["map_edit", "prioritization", "comparison", "listing_search", "unknown"] },
    proposal: {
      anyOf: [mapPatchProposalJsonSchema, { type: "null" }],
    },
    confidence: { enum: ["low", "medium", "high"] },
    caveats: {
      type: "array",
      maxItems: 50,
      items: { type: "string", maxLength: 2000 },
    },
  },
};
