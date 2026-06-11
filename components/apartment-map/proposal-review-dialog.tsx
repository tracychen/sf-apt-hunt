"use client";

import { useState } from "react";

import type { MapPatchProposal, MapState } from "@/lib/domain/types";
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
  mapState,
  proposal,
  onApply,
  onReject,
}: {
  mapState: MapState;
  proposal: MapPatchProposal | null;
  onApply: (state: MapState) => void;
  onReject: () => void;
}) {
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  if (!proposal) {
    return null;
  }

  async function handleApply() {
    if (!proposal || isApplying) {
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      const response = await fetch("/api/map/apply-proposal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ mapState, proposal }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok || !isApplyProposalResponse(body)) {
        throw new Error("The proposed changes could not be applied.");
      }

      onApply(body.state);
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "The proposed changes could not be applied.",
      );
    } finally {
      setIsApplying(false);
    }
  }

  async function handleCopyProposal() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(proposal, null, 2));
      setCopyStatus("Copied proposal JSON.");
    } catch {
      setCopyStatus("Could not copy proposal JSON.");
    }
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
        {proposal.operations.map((operation, index) => (
          <li key={`${operation.type}-${index}`}>{describeOperation(operation)}</li>
        ))}
      </ul>

      {error ? (
        <p className="mt-3 border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {copyStatus ? <p className="mt-3 text-xs text-muted-foreground">{copyStatus}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={isApplying} onClick={handleApply}>
          {isApplying ? "Applying..." : "Apply changes"}
        </Button>
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button variant="outline" onClick={handleCopyProposal}>
          Copy proposal JSON
        </Button>
      </div>
    </section>
  );
}

function isApplyProposalResponse(value: unknown): value is { ok: true; state: MapState } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { ok?: unknown }).ok === true &&
    typeof (value as { state?: unknown }).state === "object" &&
    (value as { state?: unknown }).state !== null
  );
}
