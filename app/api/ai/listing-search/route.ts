import { z } from "zod";

import { listingSearchFiltersSchema, listingSearchResponseSchema } from "@/lib/domain/schemas";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";
import {
  createOpenAiResponse,
  extractOutputText,
  getOpenAiKeyFromRequest,
} from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const priorityRequestSchema = z.enum(["high", "medium", "low"]);
const scoreRequestSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const coordinateRequestSchema = z.tuple([z.number(), z.number()]);
const noteRequestSchema = z.string().max(2_000);

const listingSearchRequestSchema = z
  .object({
    query: z.string().min(1).max(4_000),
    filters: listingSearchFiltersSchema.strict().optional(),
    selectedContext: z
      .object({
        zones: z
          .array(
            z.object({
              id: z.string().min(1).max(128),
              name: z.string().min(1).max(160),
              fitnessScore: scoreRequestSchema,
              affordabilityScore: scoreRequestSchema,
              carFreeScore: scoreRequestSchema,
              notes: z.array(noteRequestSchema).max(50),
            }).strict(),
          )
          .max(100)
          .optional(),
        corridors: z
          .array(
            z.object({
              id: z.string().min(1).max(128),
              name: z.string().min(1).max(160),
              priority: priorityRequestSchema,
              tags: z
                .array(z.enum(["fitness", "rent", "transit", "safety", "short-term"]))
                .max(5),
              notes: z.array(noteRequestSchema).max(50),
            }).strict(),
          )
          .max(100)
          .optional(),
        targets: z
          .array(
            z.object({
              id: z.string().min(1).max(128),
              name: z.string().min(1).max(160),
              purpose: z.string().min(1).max(2_000),
              coordinates: coordinateRequestSchema,
              priority: priorityRequestSchema,
              influence: z.enum(["positive", "negative", "neutral"]),
              radiusMinutes: z.union([
                z.literal(5),
                z.literal(10),
                z.literal(15),
                z.literal(20),
              ]),
              notes: z.array(noteRequestSchema).max(50),
            }).strict(),
          )
          .max(200)
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
const MAX_CANDIDATE_ID_LENGTH = 128;
const MAX_LISTING_SEARCH_REQUEST_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);

  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = listingSearchRequestSchema.parse(
      await readJsonRequestBody(request, MAX_LISTING_SEARCH_REQUEST_BYTES),
    );
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
              "Search the current web for San Francisco apartment listing candidates. Return only structured JSON. Preserve source summaries, citations, candidate citations, caveats, and whyItFits. Do not invent exact coordinates; provide geocodeQuery only when there is enough listing location text. Always set geocodeAuthorization to null. Target coordinates in selectedContext use [longitude, latitude]. Use them only as planning context; do not copy them as listing coordinates.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query: body.query,
              filters: body.filters ?? {},
              selectedContext: body.selectedContext ?? { zones: [], corridors: [], targets: [] },
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
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Listing search request is too large." },
        { status: 413 },
      );
    }

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
  const usedCandidateIds = new Set<string>();

  return {
    ...response,
    candidates: response.candidates.map((candidate, index) => {
      const id = makeUniqueCandidateId(candidate.id, index, usedCandidateIds);
      usedCandidateIds.add(id);

      return {
        ...candidate,
        id,
        coordinates: null,
        geocodeStatus: "not_attempted" as const,
        markerPrecision: "none" as const,
      };
    }),
  };
}

function makeUniqueCandidateId(id: string, index: number, usedCandidateIds: Set<string>) {
  if (!usedCandidateIds.has(id)) {
    return id;
  }

  const preferredId = appendCandidateIdSuffix(id, `-${index + 1}`);
  if (!usedCandidateIds.has(preferredId)) {
    return preferredId;
  }

  let fallbackIndex = index + 1;
  while (true) {
    const fallbackId = appendCandidateIdSuffix("candidate", `-${fallbackIndex}`);
    if (!usedCandidateIds.has(fallbackId)) {
      return fallbackId;
    }
    fallbackIndex += 1;
  }
}

function appendCandidateIdSuffix(id: string, suffix: string) {
  return `${id.slice(0, MAX_CANDIDATE_ID_LENGTH - suffix.length)}${suffix}`;
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
