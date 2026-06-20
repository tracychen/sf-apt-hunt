import { z } from "zod";

import { planningChatRequestSchema } from "@/lib/domain/schemas";
import {
  MissingStructuredOutputError as ListingMissingStructuredOutputError,
  OpenAiServiceError as ListingOpenAiServiceError,
} from "@/lib/server/listing-search-service";
import {
  MissingStructuredOutputError as MapMissingStructuredOutputError,
  OpenAiServiceError as MapOpenAiServiceError,
} from "@/lib/server/map-assistant-service";
import { getOpenAiKeyFromRequest } from "@/lib/server/openai";
import { PlanningChatError, runPlanningChat } from "@/lib/server/planning/chat";
import { getPlanningStore } from "@/lib/server/planning/store";
import { redactSecrets } from "@/lib/server/redaction";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_PLANNING_CHAT_REQUEST_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const apiKey = getOpenAiKeyFromRequest(request);
  const installationSecret = request.headers.get("x-sf-apt-installation-secret")?.trim();

  if (!apiKey) {
    return Response.json({ ok: false, error: "OpenAI key required." }, { status: 401 });
  }

  if (!installationSecret) {
    return Response.json({ ok: false, error: "Installation secret required." }, { status: 401 });
  }

  try {
    const body = planningChatRequestSchema.parse(
      await readJsonRequestBody(request, MAX_PLANNING_CHAT_REQUEST_BYTES),
    );
    const response = await runPlanningChat({
      apiKey,
      clientInstallationSecret: installationSecret,
      request: body,
      geocodeSessionId: request.headers.get("x-sf-apt-session")?.trim() || null,
      store: getPlanningStore(),
      now: new Date().toISOString(),
    });

    return Response.json(response);
  } catch (error) {
    return planningChatErrorResponse(error);
  }
}

function planningChatErrorResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return Response.json(
      { ok: false, error: "Planning chat request is too large." },
      { status: 413 },
    );
  }

  if (error instanceof PlanningChatError) {
    return Response.json(
      { ok: false, error: planningChatErrorMessage(error) },
      { status: planningChatErrorStatus(error) },
    );
  }

  if (error instanceof ListingOpenAiServiceError || error instanceof MapOpenAiServiceError) {
    return Response.json(
      {
        ok: false,
        error: "OpenAI request failed.",
        details: redactSecrets(error.body),
      },
      { status: error.status },
    );
  }

  if (
    error instanceof ListingMissingStructuredOutputError ||
    error instanceof MapMissingStructuredOutputError
  ) {
    return Response.json({ ok: false, error: "Missing structured output." }, { status: 502 });
  }

  if (error instanceof z.ZodError) {
    return Response.json(
      {
        ok: false,
        error: "Invalid planning chat request.",
        details: redactSecrets(error.issues),
      },
      { status: 400 },
    );
  }

  return Response.json(
    {
      ok: false,
      error: "Planning chat request failed.",
      details: redactSecrets(error),
    },
    { status: 500 },
  );
}

function planningChatErrorMessage(error: PlanningChatError) {
  if (error.code === "stale_map_revision") {
    return "Map revision is stale.";
  }

  if (error.code === "stale_listing_ledger_revision") {
    return "Listing ledger revision is stale.";
  }

  if (error.code === "installation_record_invalid") {
    return "Planning installation record is invalid.";
  }

  return "Planning thread is not owned by this installation.";
}

function planningChatErrorStatus(error: PlanningChatError) {
  if (error.code === "stale_map_revision" || error.code === "stale_listing_ledger_revision") {
    return 409;
  }

  if (error.code === "installation_record_invalid") {
    return 500;
  }

  return 403;
}
