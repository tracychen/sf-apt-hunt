"use client";

import { useState } from "react";

import type { Coordinate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

type ProposalOperation = MapPatchProposal["operations"][number];

function describeOperation(operation: ProposalOperation) {
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

function operationPreview(operation: ProposalOperation, mapState: MapState) {
  switch (operation.type) {
    case "updateCorridorPriority": {
      const corridor = mapState.corridors.find((item) => item.id === operation.corridorId);
      return corridor
        ? `Before: ${corridor.priority}; after: ${operation.priority}.`
        : `After: ${operation.priority}.`;
    }
    case "updateTargetPriority": {
      const target = mapState.targets.find((item) => item.id === operation.targetId);
      return target
        ? `Before: ${target.priority}; after: ${operation.priority}.`
        : `After: ${operation.priority}.`;
    }
    case "updateZoneScores": {
      const zone = mapState.zones.find((item) => item.id === operation.zoneId);
      if (!zone) {
        return "Score preview unavailable for unknown zone.";
      }

      return [
        operation.fitnessScore ? `fit ${zone.fitnessScore}->${operation.fitnessScore}` : null,
        operation.affordabilityScore
          ? `rent ${zone.affordabilityScore}->${operation.affordabilityScore}`
          : null,
        operation.carFreeScore ? `transit ${zone.carFreeScore}->${operation.carFreeScore}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    }
    case "replaceZoneGeometry": {
      const zone = mapState.zones.find((item) => item.id === operation.zoneId);
      const beforePoints = zone?.geometry.coordinates[0]?.length ?? 0;
      const afterPoints = operation.geometry.coordinates[0]?.length ?? 0;
      return `Geometry preview: ${beforePoints} current points -> ${afterPoints} proposed points.`;
    }
    case "addTarget":
      return `Coordinates: ${operation.target.coordinates[1].toFixed(5)}, ${operation.target.coordinates[0].toFixed(5)}.`;
    case "addCorridor":
      return `Geometry preview: ${operation.corridor.geometry.coordinates.length} corridor points.`;
    case "addNote":
      return operation.note;
  }
}

function GeometryPreview({
  current,
  proposed,
}: {
  current: Coordinate[] | null;
  proposed: Coordinate[];
}) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <CoordinatePreviewList label="Current geometry" coordinates={current} />
      <CoordinatePreviewList label="Proposed geometry" coordinates={proposed} />
    </div>
  );
}

function CoordinatePreviewList({
  coordinates,
  label,
}: {
  coordinates: Coordinate[] | null;
  label: string;
}) {
  return (
    <div className="border border-border bg-background p-2">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      {coordinates ? (
        <ol className="mt-1 space-y-0.5 font-mono text-[10px] leading-4 text-muted-foreground">
          {coordinates.slice(0, 8).map((coordinate, index) => (
            <li key={`${label}-${index}`}>
              {index + 1}. {formatCoordinate(coordinate)}
            </li>
          ))}
          {coordinates.length > 8 ? <li>... {coordinates.length - 8} more points</li> : null}
        </ol>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground">No current geometry.</p>
      )}
    </div>
  );
}

function GeometryPreviewForOperation({
  mapState,
  operation,
}: {
  mapState: MapState;
  operation: ProposalOperation;
}) {
  if (operation.type === "replaceZoneGeometry") {
    const zone = mapState.zones.find((item) => item.id === operation.zoneId);
    return (
      <GeometryPreview
        current={zone?.geometry.coordinates[0] ?? null}
        proposed={operation.geometry.coordinates[0] ?? []}
      />
    );
  }

  if (operation.type === "addCorridor") {
    return <GeometryPreview current={null} proposed={operation.corridor.geometry.coordinates} />;
  }

  if (operation.type === "addTarget") {
    return <GeometryPreview current={null} proposed={[operation.target.coordinates]} />;
  }

  return null;
}

function formatCoordinate([lng, lat]: Coordinate) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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
          <li key={`${operation.type}-${index}`}>
            <span className="font-medium text-foreground">{describeOperation(operation)}</span>
            <span className="mt-0.5 block">{operationPreview(operation, mapState)}</span>
            <GeometryPreviewForOperation mapState={mapState} operation={operation} />
          </li>
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
