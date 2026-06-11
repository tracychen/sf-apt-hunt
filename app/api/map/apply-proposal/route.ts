import { z } from "zod";

import { mapPatchProposalSchema, mapStateSchema } from "@/lib/domain/schemas";
import { applyProposal } from "@/lib/map/proposals";
import { redactSecrets } from "@/lib/server/redaction";

const applyProposalRequestSchema = z.object({
  mapState: mapStateSchema,
  proposal: mapPatchProposalSchema,
});

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
    const body = await request.json();
    const { mapState, proposal } = applyProposalRequestSchema.parse(body);
    const result = applyProposal(mapState, proposal);

    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: 400 });
    }

    return Response.json({ ok: true, state: result.state });
  } catch (error) {
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
