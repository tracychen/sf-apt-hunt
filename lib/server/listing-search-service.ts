import { z } from "zod";

import {
  listingSearchFiltersSchema,
  listingSearchResponseSchema,
} from "@/lib/domain/schemas";
import type { ListingSearchResponse } from "@/lib/domain/types";
import { createGeocodeAuthorization } from "@/lib/server/geocode-auth";
import { createOpenAiResponse, extractOutputText } from "@/lib/server/openai";

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

export const listingSearchSelectedContextSchema = z
  .object({
    zones: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            name: z.string().min(1).max(160),
            fitnessScore: scoreRequestSchema,
            affordabilityScore: scoreRequestSchema,
            carFreeScore: scoreRequestSchema,
            notes: z.array(noteRequestSchema).max(50),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    areas: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            name: z.string().min(1).max(160),
            purpose: z.string().min(1).max(2_000),
            geometry: z
              .object({
                type: z.literal("Polygon"),
                coordinates: z
                  .array(z.array(coordinateRequestSchema).min(4).max(200))
                  .min(1)
                  .max(8),
              })
              .strict(),
            priority: priorityRequestSchema,
            influence: z.enum(["positive", "negative", "neutral"]),
            notes: z.array(noteRequestSchema).max(50),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    corridors: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            name: z.string().min(1).max(160),
            priority: priorityRequestSchema,
            tags: z
              .array(z.enum(["fitness", "rent", "transit", "safety", "short-term"]))
              .max(5),
            notes: z.array(noteRequestSchema).max(50),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    targets: z
      .array(
        z
          .object({
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
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

export const runListingSearchInputSchema = z
  .object({
    apiKey: z.string().min(1),
    query: z.string().min(1).max(4_000),
    filters: listingSearchFiltersSchema.optional(),
    selectedContext: listingSearchSelectedContextSchema.optional(),
    appContext: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ListingSearchSelectedContext = z.infer<typeof listingSearchSelectedContextSchema>;
export type RunListingSearchInput = z.infer<typeof runListingSearchInputSchema>;

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

export class OpenAiServiceError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super("OpenAI request failed.");
    this.name = "OpenAiServiceError";
    this.status = status;
    this.body = body;
  }
}

export class MissingStructuredOutputError extends Error {
  constructor() {
    super("Missing structured output.");
    this.name = "MissingStructuredOutputError";
  }
}

export async function runListingSearch(rawInput: RunListingSearchInput): Promise<ListingSearchResponse> {
  const input = runListingSearchInputSchema.parse(rawInput);
  const openAiResponse = await createOpenAiResponse({
    apiKey: input.apiKey,
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
            "Search the current web for San Francisco apartment listing candidates. Return only structured JSON. Preserve source summaries, citations, candidate citations, caveats, and whyItFits. " +
            "Each candidate's url must be a real listing page that appeared in your web search results; never invent, guess, or modify a URL or its listing ID. " +
            "Only include listings that appear currently active. If you cannot confirm a listing is still available, keep it but add a caveat noting it may be expired. " +
            "Set priceMonthly only to the monthly rent shown on that candidate's own listing page. If the rent is unclear, includes fees you cannot total, or sources disagree, set priceMonthly to null and explain in a caveat. Never average, estimate, or copy a price from a different source. " +
            "Do not invent exact coordinates; provide geocodeQuery only when there is enough listing location text. Always set geocodeAuthorization to null. " +
            "Target coordinates in selectedContext use [longitude, latitude]. Use them only as planning context; do not copy them as listing coordinates.",
        },
        {
          role: "user",
          content: JSON.stringify({
            query: input.query,
            filters: input.filters ?? {},
            selectedContext: input.selectedContext ?? { zones: [], areas: [], corridors: [], targets: [] },
            appContext: input.appContext ?? {},
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
    throw new OpenAiServiceError(openAiResponse.status, openAiResponse.body);
  }

  const outputText = extractOutputText(openAiResponse.body);

  if (!outputText) {
    throw new MissingStructuredOutputError();
  }

  const parsedOutput = JSON.parse(outputText);
  const parsedResponse = sanitizeListingSearchResponse(
    listingSearchResponseSchema.parse(parsedOutput),
  );

  return {
    ...parsedResponse,
    geocodeAuthorization: mintGeocodeAuthorization(parsedResponse.candidates),
  };
}

function sanitizeListingSearchResponse(
  response: Omit<ListingSearchResponse, "geocodeAuthorization">,
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

function mintGeocodeAuthorization(candidates: ListingSearchResponse["candidates"]) {
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
