import { z } from "zod";

import { createExtensionConnectionRequestSchema } from "@/lib/domain/schemas";
import { UnauthorizedError, requireCurrentUser } from "@/lib/server/auth/session";
import { createExtensionConnection } from "@/lib/server/extension/connections";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";
import { ForbiddenOriginError, assertSameOriginRequest } from "@/lib/server/security/origin";

const MAX_EXTENSION_CONNECTION_REQUEST_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const user = await requireCurrentUser(request);
    const body = createExtensionConnectionRequestSchema.parse(
      await readJsonRequestBody(request, MAX_EXTENSION_CONNECTION_REQUEST_BYTES),
    );
    const result = await createExtensionConnection({
      user,
      extensionId: body.extensionId,
    });

    return Response.json(result, { status: result.ok ? 200 : 403 });
  } catch (error) {
    if (error instanceof ForbiddenOriginError) {
      return Response.json({ ok: false, error: "Forbidden origin." }, { status: 403 });
    }

    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Extension connection request is too large." },
        { status: 413 },
      );
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }

    console.error("[extension-connections-route]", error);
    return Response.json({ ok: false, error: "invalid_request" }, { status: 500 });
  }
}
