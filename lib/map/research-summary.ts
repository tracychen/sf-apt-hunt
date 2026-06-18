import type { MapPatchProposal, ResearchSummary } from "@/lib/domain/types";

export type ResearchSummaryCorrelationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateResearchSummaryCorrelation({
  proposal,
  researchSummary,
  requireMetadataForAllResearchOperations = true,
}: {
  proposal: MapPatchProposal;
  researchSummary: ResearchSummary;
  requireMetadataForAllResearchOperations?: boolean;
}): ResearchSummaryCorrelationResult {
  const expectedKeys = new Set<string>();

  for (const operation of proposal.operations) {
    if (operation.type === "addTarget") {
      expectedKeys.add(createResearchSummaryKey("addTarget", operation.target.id));
    }

    if (operation.type === "addCorridor") {
      expectedKeys.add(createResearchSummaryKey("addCorridor", operation.corridor.id));
    }
  }

  const actualKeys = new Set<string>();
  for (const item of researchSummary.items) {
    const key = createResearchSummaryKey(item.operationType, item.entityId);

    if (actualKeys.has(key)) {
      return {
        ok: false,
        error: "Research summary contains duplicate metadata for a proposed operation.",
      };
    }

    actualKeys.add(key);
  }

  if (requireMetadataForAllResearchOperations) {
    for (const expectedKey of expectedKeys) {
      if (!actualKeys.has(expectedKey)) {
        return {
          ok: false,
          error: "Research summary is missing metadata for a proposed researched operation.",
        };
      }
    }
  }

  for (const actualKey of actualKeys) {
    if (!expectedKeys.has(actualKey)) {
      return {
        ok: false,
        error: "Research summary references an operation that is not in the proposal.",
      };
    }
  }

  return { ok: true };
}

function createResearchSummaryKey(operationType: "addTarget" | "addCorridor", entityId: string) {
  return `${operationType}:${entityId}`;
}
