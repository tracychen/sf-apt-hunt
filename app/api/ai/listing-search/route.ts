import { z } from "zod";

import { listingSearchResponseSchema } from "@/lib/domain/schemas";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";
import {
  createOpenAiResponse,
  extractOutputText,
  getOpenAiKeyFromRequest,
} from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";

const listingSearchRequestSchema = z
  .object({
    query: z.string().min(1).max(4_000),
    filters: z.record(z.string(), z.unknown()).optional(),
    selectedContext: z
      .object({
        zones: z
          .array(
            z.object({
              id: z.string().min(1).max(128),
              name: z.string().min(1).max(160),
            }),
          )
          .max(100)
          .optional(),
        corridors: z
          .array(
            z.object({
              id: z.string().min(1).max(128),
              name: z.string().min(1).max(160),
              priority: z.enum(["high", "medium", "low"]),
            }),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const citationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url", "title", "sourceDomain"],
  properties: {
    url: { type: "string", maxLength: 2048 },
    title: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
    sourceDomain: { type: "string", minLength: 1, maxLength: 128 },
  },
};

const listingSearchJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "sourceSummary", "citations", "caveats", "geocodeAuthorization"],
  properties: {
    candidates: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "url",
          "sourceDomain",
          "neighborhoodGuess",
          "locationText",
          "geocodeQuery",
          "locationConfidence",
          "coordinates",
          "geocodeStatus",
          "markerPrecision",
          "priceMonthly",
          "beds",
          "shortTermSignal",
          "furnishedSignal",
          "fitScore",
          "whyItFits",
          "citations",
          "caveats",
        ],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 128 },
          title: { type: "string", minLength: 1, maxLength: 160 },
          url: { type: "string", maxLength: 2048 },
          sourceDomain: { type: "string", minLength: 1, maxLength: 128 },
          neighborhoodGuess: { type: "string", minLength: 1, maxLength: 160 },
          locationText: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
          geocodeQuery: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
          locationConfidence: { enum: ["none", "low", "medium", "high"] },
          coordinates: { type: "null" },
          geocodeStatus: { enum: ["not_attempted"] },
          markerPrecision: { enum: ["none"] },
          priceMonthly: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          beds: { enum: ["studio", "1br", "unknown"] },
          shortTermSignal: { type: "boolean" },
          furnishedSignal: { type: "boolean" },
          fitScore: { enum: [1, 2, 3, 4, 5] },
          whyItFits: { type: "string", minLength: 1, maxLength: 2000 },
          citations: { type: "array", minItems: 1, maxItems: 50, items: citationJsonSchema },
          caveats: { type: "array", maxItems: 50, items: { type: "string", maxLength: 2000 } },
        },
      },
    },
    sourceSummary: { type: "string", maxLength: 4000 },
    citations: { type: "array", maxItems: 50, items: citationJsonSchema },
    caveats: { type: "array", maxItems: 50, items: { type: "string", maxLength: 2000 } },
    geocodeAuthorization: { type: "null" },
  },
};

const GEOCODE_AUTHORIZATION_TTL_SECONDS = 10 * 60;
const MAX_AUTHORIZED_GEOCODE_CANDIDATES = 10;

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);

  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = listingSearchRequestSchema.parse(await request.json());
    const openAiResponse = await createOpenAiResponse({
      apiKey,
      payload: {
        model: process.env.OPENAI_MODEL ?? "gpt-5.5",
        store: false,
        reasoning: { effort: "medium" },
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: [
          {
            role: "developer",
            content:
              "Search the current web for San Francisco apartment listing candidates. Return only structured JSON. Preserve source summaries, citations, candidate citations, caveats, and whyItFits. Do not invent exact coordinates; provide geocodeQuery only when there is enough listing location text. Always set geocodeAuthorization to null.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query: body.query,
              filters: body.filters ?? {},
              selectedContext: body.selectedContext ?? { zones: [], corridors: [] },
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "listing_search_response",
            strict: true,
            schema: listingSearchJsonSchema,
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
    const parsedResponse = sanitizeListingSearchResponse(
      listingSearchResponseSchema.parse(parsedOutput),
    );

    return Response.json({
      ...parsedResponse,
      geocodeAuthorization: mintGeocodeAuthorization(parsedResponse.candidates),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "Invalid listing search request.",
        details: redactSecrets(getErrorDetails(error)),
      },
      { status: 400 },
    );
  }
}

function sanitizeListingSearchResponse(
  response: z.infer<typeof listingSearchResponseSchema>,
) {
  return {
    ...response,
    candidates: response.candidates.map((candidate) => ({
      ...candidate,
      coordinates: null,
      geocodeStatus: "not_attempted" as const,
      markerPrecision: "none" as const,
    })),
  };
}

function mintGeocodeAuthorization(
  candidates: z.infer<typeof listingSearchResponseSchema>["candidates"],
) {
  const secret = process.env.GEOCODE_NONCE_SECRET;

  if (!secret) {
    return null;
  }

  const geocodeableCandidates = candidates
    .filter((candidate) => Boolean(candidate.geocodeQuery))
    .slice(0, MAX_AUTHORIZED_GEOCODE_CANDIDATES);

  if (geocodeableCandidates.length === 0) {
    return null;
  }

  return createGeocodeAuthorization({
    secret,
    candidates: geocodeableCandidates,
    maxAttempts: geocodeableCandidates.length,
    ttlSeconds: GEOCODE_AUTHORIZATION_TTL_SECONDS,
  });
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
