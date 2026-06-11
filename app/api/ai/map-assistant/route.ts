import { z } from "zod";

import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import {
  createOpenAiResponse,
  extractOutputText,
  getOpenAiKeyFromRequest,
} from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";

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
    intent: z.string().min(1).max(160),
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
    const body = mapAssistantRequestSchema.parse(await request.json());
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

    const parsedOutput = JSON.parse(outputText);
    const parsedResponse = mapAssistantResponseSchema.parse(parsedOutput);

    return Response.json(parsedResponse);
  } catch (error) {
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

const scoreJsonSchema = { enum: [1, 2, 3, 4, 5] };
const priorityJsonSchema = { enum: ["high", "medium", "low"] };
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
const targetPointJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "coordinates", "priority", "notes"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    coordinates: coordinateJsonSchema,
    priority: priorityJsonSchema,
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
            required: ["type", "zoneId"],
            properties: {
              type: { const: "updateZoneScores" },
              zoneId: { type: "string", minLength: 1, maxLength: 128 },
              fitnessScore: scoreJsonSchema,
              affordabilityScore: scoreJsonSchema,
              carFreeScore: scoreJsonSchema,
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
    intent: { type: "string", minLength: 1, maxLength: 160 },
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
