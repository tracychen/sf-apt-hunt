import { z } from "zod";

import { mapStateSchema } from "@/lib/domain/schemas";
import {
  MissingStructuredOutputError,
  OpenAiServiceError,
  runMapAssistant,
} from "@/lib/server/map-assistant-service";
import { getOpenAiKeyFromRequest } from "@/lib/server/openai";
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

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);

  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  try {
    const body = mapAssistantRequestSchema.parse(
      await readJsonRequestBody(request, MAX_MAP_ASSISTANT_REQUEST_BYTES),
    );

    try {
      return Response.json(
        await runMapAssistant({
          apiKey,
          message: body.message,
          mapState: body.mapState,
          selectedZoneIds: body.selectedZoneIds ?? [],
          activeFilters: body.activeFilters,
          geocodeSessionId: request.headers.get("x-sf-apt-session")?.trim() || null,
          clientIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip",
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
