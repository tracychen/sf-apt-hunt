import { z } from "zod";

import { facebookListingImportRequestSchema } from "@/lib/domain/schemas";
import { validateExtensionBearer } from "@/lib/server/extension/connections";
import { importFacebookListing } from "@/lib/server/imports/facebook-listings";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const MAX_FACEBOOK_IMPORT_REQUEST_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const token = readBearerToken(request);
  const extensionId = request.headers.get("x-sf-apt-extension-id")?.trim() ?? "";

  if (!token || !extensionId) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const validation = await validateExtensionBearer({ token, extensionId });

  if (!validation.ok) {
    return Response.json(validation, { status: 401 });
  }

  try {
    const body = facebookListingImportRequestSchema.parse(
      await readJsonRequestBody(request, MAX_FACEBOOK_IMPORT_REQUEST_BYTES),
    );
    const result = await importFacebookListing({
      workspaceId: validation.workspaceId,
      request: body,
    });

    return Response.json(result, {
      status: result.ok ? 200 : result.error === "idempotency_conflict" ? 409 : 400,
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 413 });
    }

    if (error instanceof z.ZodError) {
      const errorCode = hasFacebookUrlError(error) ? "invalid_group_context" : "invalid_request";
      return Response.json({ ok: false, error: errorCode }, { status: 400 });
    }

    if (error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }

    console.error("[facebook-listings-import-route]", error);
    return Response.json({ ok: false, error: "import_failed" }, { status: 500 });
  }
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

function hasFacebookUrlError(error: z.ZodError) {
  return error.issues.some((issue) => {
    const field = issue.path[0];
    return field === "sourceGroupUrl" || field === "sourcePostUrl";
  });
}
