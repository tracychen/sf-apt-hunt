import { z } from "zod";

import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import { applyProposal } from "@/lib/map/proposals";
import { redactSecrets } from "@/lib/server/redaction";
import { RequestBodyTooLargeError, readJsonRequestBody } from "@/lib/server/request-body";

const applyProposalRequestSchema = z.object({
  mapState: mapStateSchema,
  proposal: mapPatchProposalSchema,
});

const MAX_PROPOSAL_REQUEST_BYTES = 256 * 1024;

function getErrorDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return error;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonRequestBody(request, MAX_PROPOSAL_REQUEST_BYTES);
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
