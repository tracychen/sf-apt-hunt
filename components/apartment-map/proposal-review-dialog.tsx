"use client";

import { useState } from "react";

import { mapStateSchema } from "@/lib/domain/schemas";
import type { Coordinate, MapPatchProposal, MapState, ResearchSummary } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";

type ProposalOperation = MapPatchProposal["operations"][number];

type ResearchSummaryItem = ResearchSummary["items"][number];
type ResearchExclusion = ResearchSummary["exclusions"][number];

const proposalResearchSummaries = new WeakMap<MapPatchProposal, ResearchSummary>();

export function registerProposalResearchSummary(
  proposal: MapPatchProposal | null,
  researchSummary: ResearchSummary | null,
) {
  if (!proposal) {
    return;
  }

  if (researchSummary) {
    proposalResearchSummaries.set(proposal, researchSummary);
    return;
  }

  proposalResearchSummaries.delete(proposal);
}

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
    case "updateTargetPlanningFields":
      return `Update target planning fields: ${operation.targetId}`;
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
    case "updateTargetPlanningFields": {
      const target = mapState.targets.find((item) => item.id === operation.targetId);
      if (!target) {
        return "Planning field preview unavailable for unknown target.";
      }

      return [
        operation.name !== undefined ? `name ${target.name}->${operation.name}` : null,
        operation.purpose !== undefined ? `purpose ${target.purpose}->${operation.purpose}` : null,
        operation.influence !== undefined
          ? `influence ${target.influence}->${operation.influence}`
          : null,
        operation.priority !== undefined
          ? `priority ${target.priority}->${operation.priority}`
          : null,
        operation.radiusMinutes !== undefined
          ? `radius ${target.radiusMinutes}->${operation.radiusMinutes} min`
          : null,
        operation.notes !== undefined
          ? `notes Before: ${formatNotesPreview(target.notes)}; After: ${formatNotesPreview(operation.notes)}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
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

function ResearchMetadata({ item }: { item: ResearchSummaryItem }) {
  return (
    <div className="mt-2 border border-border bg-muted/30 p-2 text-[11px] leading-5 text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-foreground">Research</span>
        <span>{formatConfidence(item.confidence)} confidence</span>
        {item.geometryQuality ? <span>Geometry: {formatGeometryQuality(item.geometryQuality)}</span> : null}
        {item.geocodePrecision ? <span>Geocode: {item.geocodePrecision}</span> : null}
      </div>
      <p className="mt-1 break-words">
        Source: <SourceLink source={item.source} />
      </p>
      {item.caveats.length > 0 ? (
        <p className="mt-1 break-words">Caveats: {item.caveats.join(" / ")}</p>
      ) : null}
    </div>
  );
}

function ResearchSummaryDetails({ researchSummary }: { researchSummary: ResearchSummary | null }) {
  if (!researchSummary) {
    return null;
  }

  const hasCaveats = researchSummary.caveats.length > 0;
  const hasExclusions = researchSummary.exclusions.length > 0;

  if (!hasCaveats && !hasExclusions) {
    return null;
  }

  return (
    <div className="mt-3 border border-border bg-muted/30 p-2 text-xs leading-5 text-muted-foreground">
      <p className="font-medium text-foreground">Research summary</p>
      {hasCaveats ? <p className="mt-1 break-words">Caveats: {researchSummary.caveats.join(" / ")}</p> : null}
      {hasExclusions ? (
        <div className="mt-2">
          <p className="font-medium text-foreground">Excluded results</p>
          <ul className="mt-1 space-y-1">
            {researchSummary.exclusions.map((exclusion, index) => (
              <ResearchExclusionItem
                key={`${exclusion.label}-${exclusion.reason}-${index}`}
                exclusion={exclusion}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ResearchExclusionItem({ exclusion }: { exclusion: ResearchExclusion }) {
  return (
    <li className="break-words">
      <span className="font-medium text-foreground">{exclusion.label}</span>:{" "}
      {formatExclusionReason(exclusion.reason)}
      {exclusion.source ? (
        <>
          {" "}
          Source: <SourceLink source={exclusion.source} />
        </>
      ) : null}
      {exclusion.caveats.length > 0 ? <> Caveats: {exclusion.caveats.join(" / ")}</> : null}
    </li>
  );
}

function SourceLink({ source }: { source: ResearchSummaryItem["source"] }) {
  return (
    <>
      <a
        className="underline underline-offset-2"
        href={source.url}
        rel="noreferrer"
        target="_blank"
      >
        {source.title?.trim() || source.sourceDomain}
      </a>
      <span className="ml-1">({source.sourceDomain})</span>
    </>
  );
}

function formatCoordinate([lng, lat]: Coordinate) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatNotesPreview(notes: string[]) {
  return notes.length > 0 ? notes.join(" / ") : "none";
}

function findResearchItem(researchSummary: ResearchSummary | null, operation: ProposalOperation) {
  if (!researchSummary) {
    return null;
  }

  if (operation.type === "addTarget") {
    return (
      researchSummary.items.find(
        (item) => item.operationType === "addTarget" && item.entityId === operation.target.id,
      ) ?? null
    );
  }

  if (operation.type === "addCorridor") {
    return (
      researchSummary.items.find(
        (item) => item.operationType === "addCorridor" && item.entityId === operation.corridor.id,
      ) ?? null
    );
  }

  return null;
}

function formatConfidence(confidence: ResearchSummaryItem["confidence"]) {
  return confidence[0].toUpperCase() + confidence.slice(1);
}

function formatGeometryQuality(quality: NonNullable<ResearchSummaryItem["geometryQuality"]>) {
  return quality === "fromStops" ? "from stops" : quality;
}

function formatExclusionReason(reason: ResearchExclusion["reason"]) {
  return reason.replaceAll("_", " ");
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

  const researchSummary = proposalResearchSummaries.get(proposal) ?? null;

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
      const nextState = response.ok ? parseApplyProposalResponse(body) : null;

      if (!nextState) {
        throw new Error("The proposed changes could not be applied.");
      }

      onApply(nextState);
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
        {proposal.operations.map((operation, index) => {
          const researchItem = findResearchItem(researchSummary, operation);

          return (
            <li key={`${operation.type}-${index}`}>
              <span className="font-medium text-foreground">{describeOperation(operation)}</span>
              <span className="mt-0.5 block">{operationPreview(operation, mapState)}</span>
              <GeometryPreviewForOperation mapState={mapState} operation={operation} />
              {researchItem ? <ResearchMetadata item={researchItem} /> : null}
            </li>
          );
        })}
      </ul>

      <ResearchSummaryDetails researchSummary={researchSummary} />

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

function parseApplyProposalResponse(value: unknown): MapState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  if ((value as { ok?: unknown }).ok !== true) {
    return null;
  }

  const parsed = mapStateSchema.safeParse((value as { state?: unknown }).state);
  return parsed.success ? parsed.data : null;
}
