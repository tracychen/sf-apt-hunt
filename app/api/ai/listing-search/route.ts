import { z } from "zod";

import { listingSearchFiltersSchema } from "@/lib/domain/schemas";
import {
  listingSearchSelectedContextSchema,
  MissingStructuredOutputError,
  OpenAiServiceError,
  runListingSearch,
} from "@/lib/server/listing-search-service";
import { getOpenAiKeyFromRequest } from "@/lib/server/openai";
import { redactSecrets } from "@/lib/server/redaction";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_LISTING_SEARCH_REQUEST_BYTES = 256 * 1024;

const listingSearchRequestSchema = z
  .object({
    query: z.string().min(1).max(4_000),
    filters: listingSearchFiltersSchema.strict().optional(),
    selectedContext: listingSearchSelectedContextSchema.optional(),
  })
  .strict();

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);

  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = listingSearchRequestSchema.parse(
      await readJsonRequestBody(request, MAX_LISTING_SEARCH_REQUEST_BYTES),
    );

    try {
      return Response.json(
        await runListingSearch({
          apiKey,
          query: body.query,
          filters: body.filters,
          selectedContext: body.selectedContext,
        }),
      );
    } catch (error) {
      if (error instanceof OpenAiServiceError) {
        return Response.json(
          {
            ok: false,
            error: "OpenAI request failed.",
            details: redactSecrets(error.body),
          },
          { status: error.status },
        );
      }

      if (error instanceof MissingStructuredOutputError) {
        return Response.json(
          { ok: false, error: "Missing structured output." },
          { status: 502 },
        );
      }

      throw error;
    }
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

function getErrorDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return error;
}
