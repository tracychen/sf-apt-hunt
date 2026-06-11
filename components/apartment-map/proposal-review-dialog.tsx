"use client";

import type { MapPatchProposal } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

function describeOperation(operation: MapPatchProposal["operations"][number]) {
  switch (operation.type) {
    case "addTarget":
      return `Add target: ${operation.target.name}`;
    case "addCorridor":
      return `Add corridor: ${operation.corridor.name}`;
    case "updateCorridorPriority":
      return `Set corridor ${operation.corridorId} to ${operation.priority}`;
    case "updateTargetPriority":
      return `Set target ${operation.targetId} to ${operation.priority}`;
    case "updateZoneScores":
      return `Update zone scores: ${operation.zoneId}`;
    case "replaceZoneGeometry":
      return `Replace zone geometry: ${operation.zoneId}`;
    case "addNote":
      return `Add note to ${operation.entityId}`;
  }
}

export function ProposalReviewDialog({
  proposal,
  onApply,
  onReject,
}: {
  proposal: MapPatchProposal | null;
  onApply: () => void;
  onReject: () => void;
}) {
  if (!proposal) {
    return null;
  }

  return (
    <section
      aria-labelledby="proposal-review-title"
      className="border border-primary bg-background p-3 text-sm"
      role="region"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="proposal-review-title" className="font-medium">
            Review proposed map changes
          </h2>
          <p className="mt-1 text-xs uppercase text-muted-foreground">
            {proposal.confidence} confidence / {proposal.operations.length} operations
          </p>
        </div>
        <span className="border border-primary px-2 py-1 text-[10px] uppercase text-primary">
          Review
        </span>
      </div>

      <p className="mt-3 text-sm leading-5">{proposal.summary}</p>

      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {proposal.operations.slice(0, 5).map((operation, index) => (
          <li key={`${operation.type}-${index}`}>{describeOperation(operation)}</li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onApply}>Apply changes</Button>
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
      </div>
    </section>
  );
}
