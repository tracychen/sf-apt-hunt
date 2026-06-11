import { z } from "zod";

import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import { applyProposal } from "@/lib/map/proposals";
import { redactSecrets } from "@/lib/server/redaction";

const applyProposalRequestSchema = z.object({
  mapState: mapStateSchema,
  proposal: mapPatchProposalSchema,
});

const MAX_PROPOSAL_REQUEST_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {}

function getErrorDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return error;
}

async function readRequestBodyText(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();

  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytesRead += value.byteLength;

    if (bytesRead > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }

    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

export async function POST(request: Request) {
  try {
    const bodyText = await readRequestBodyText(request, MAX_PROPOSAL_REQUEST_BYTES);
    const body = JSON.parse(bodyText);
    const { mapState, proposal } = applyProposalRequestSchema.parse(body);
    const result = applyProposal(mapState, proposal);

    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    const parsedState = mapStateSchema.safeParse(result.state);

    if (!parsedState.success) {
      return Response.json(
        { ok: false, error: "Proposal exceeds map limits." },
        { status: 400 },
      );
    }

    return Response.json({ ok: true, state: parsedState.data });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json(
        { ok: false, error: "Proposal request is too large." },
        { status: 413 },
      );
    }

    return Response.json(
      {
        ok: false,
        error: "Invalid proposal request.",
        details: redactSecrets(getErrorDetails(error)),
      },
      { status: 400 },
    );
  }
}
