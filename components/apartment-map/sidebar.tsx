"use client";

import { useState } from "react";

import type {
  ListingCandidate,
  ListingSearchResponse,
  MapPatchProposal,
  MapState,
} from "@/lib/domain/types";
import type {
  SelectedMapEntity,
  VisibleMapLayers,
} from "@/components/apartment-map/leaflet-map";
import { ApiKeyDialog } from "@/components/apartment-map/api-key-dialog";
import { AssistantPanel } from "@/components/apartment-map/assistant-panel";
import { CorridorEditor } from "@/components/apartment-map/corridor-editor";
import { ListingResults } from "@/components/apartment-map/listing-results";
import { ProposalReviewDialog } from "@/components/apartment-map/proposal-review-dialog";
import { TargetEditor } from "@/components/apartment-map/target-editor";
import { Button } from "@/components/ui/button";
import { formatTargetLabel } from "@/lib/map/target-points";

export function Sidebar({
  apiKey,
  remembered,
  mapState,
  selectedEntity,
  visibleLayers,
  selectedZoneIds,
  listings,
  listingSearchMeta,
  proposal,
  onApiKeyChange,
  onMapStateChange,
  onVisibleLayersChange,
  onListingSearchResponse,
  onProposalChange,
  onApplyProposal,
  onRejectProposal,
  onUndo,
  onReset,
  onResetSelectedShapes,
  canUndo,
  canResetSelectedShapes,
}: {
  apiKey: string | null;
  remembered: boolean;
  mapState: MapState;
  selectedEntity: SelectedMapEntity;
  visibleLayers: VisibleMapLayers;
  selectedZoneIds: string[];
  listings: ListingCandidate[];
  listingSearchMeta: Pick<ListingSearchResponse, "sourceSummary" | "citations" | "caveats"> | null;
  proposal: MapPatchProposal | null;
  onApiKeyChange: (key: string | null, remembered: boolean) => void;
  onMapStateChange: (state: MapState) => void;
  onVisibleLayersChange: (layers: VisibleMapLayers) => void;
  onListingSearchResponse: (response: ListingSearchResponse) => void;
  onProposalChange: (proposal: MapPatchProposal | null) => void;
  onApplyProposal: (state: MapState) => void;
  onRejectProposal: () => void;
  onUndo: () => void;
  onReset: () => void;
  onResetSelectedShapes: () => void;
  canUndo: boolean;
  canResetSelectedShapes: boolean;
}) {
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const selectedCorridor =
    selectedEntity?.kind === "corridor"
      ? mapState.corridors.find((corridor) => corridor.id === selectedEntity.id) ?? null
      : null;
  const selectedTarget =
    selectedEntity?.kind === "target"
      ? mapState.targets.find((target) => target.id === selectedEntity.id) ?? null
      : null;

  function toggleLayer(layer: keyof VisibleMapLayers) {
    onVisibleLayersChange({
      ...visibleLayers,
      [layer]: !visibleLayers[layer],
    });
  }

  async function copyMapJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(mapState, null, 2));
      setExportStatus("Copied local map JSON.");
    } catch {
      setExportStatus("Could not copy local map JSON.");
    }
  }

  return (
    <aside className="flex min-h-[42vh] flex-col bg-sidebar text-sidebar-foreground lg:max-h-screen lg:min-h-screen lg:overflow-y-auto">
      <div className="border-b border-sidebar-border p-4">
        <p className="text-xs uppercase text-muted-foreground">Local-first workspace</p>
        <h1 className="mt-1 text-xl font-semibold">SF Apartment Hunt</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {mapState.zones.length} zones, {selectedZoneIds.length} selected,{" "}
          {listings.length} listings staged.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Active shape: {describeSelectedEntity(selectedEntity, mapState)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-sidebar-border p-3">
        <Button disabled={!canUndo} variant="outline" onClick={onUndo}>
          Undo
        </Button>
        <Button disabled={!canResetSelectedShapes} variant="outline" onClick={onResetSelectedShapes}>
          Reset selected shape
        </Button>
        <Button variant="outline" onClick={onReset}>
          Reset local map
        </Button>
        <Button variant="outline" onClick={copyMapJson}>
          Copy map JSON
        </Button>
      </div>

      <div className="space-y-4 p-4">
        <section className="border border-sidebar-border bg-background p-3 text-sm">
          <h2 className="font-medium">Map layers</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            {(["zones", "corridors", "targets", "listings"] as const).map((layer) => (
              <label key={layer} className="flex items-center gap-2">
                <input
                  className="size-3.5"
                  type="checkbox"
                  checked={visibleLayers[layer]}
                  onChange={() => toggleLayer(layer)}
                />
                {layer[0].toUpperCase()}
                {layer.slice(1)}
              </label>
            ))}
          </div>
          {exportStatus ? <p className="mt-3 text-xs text-muted-foreground">{exportStatus}</p> : null}
        </section>

        {selectedTarget ? (
          <TargetEditor
            mapState={mapState}
            target={selectedTarget}
            onMapStateChange={onMapStateChange}
          />
        ) : null}

        {selectedCorridor ? (
          <CorridorEditor
            corridor={selectedCorridor}
            mapState={mapState}
            onMapStateChange={onMapStateChange}
          />
        ) : null}

        <ApiKeyDialog
          apiKey={apiKey}
          remembered={remembered}
          onApiKeyChange={onApiKeyChange}
        />
        <AssistantPanel
          apiKey={apiKey}
          mapState={mapState}
          selectedZoneIds={selectedZoneIds}
          onProposalChange={onProposalChange}
          onListingSearchResponse={onListingSearchResponse}
        />
        <ListingResults
          listings={listings}
          sourceSummary={listingSearchMeta?.sourceSummary ?? null}
          sourceCitations={listingSearchMeta?.citations ?? []}
          sourceCaveats={listingSearchMeta?.caveats ?? []}
        />
        <ProposalReviewDialog
          mapState={mapState}
          proposal={proposal}
          onApply={onApplyProposal}
          onReject={onRejectProposal}
        />
      </div>
    </aside>
  );
}

function describeSelectedEntity(selectedEntity: SelectedMapEntity, mapState: MapState) {
  if (!selectedEntity) {
    return "None";
  }

  if (selectedEntity.kind === "zone") {
    return mapState.zones.find((zone) => zone.id === selectedEntity.id)?.name ?? selectedEntity.id;
  }

  if (selectedEntity.kind === "corridor") {
    return (
      mapState.corridors.find((corridor) => corridor.id === selectedEntity.id)?.name ??
      selectedEntity.id
    );
  }

  const target = mapState.targets.find((item) => item.id === selectedEntity.id);
  return target ? formatTargetLabel(target) : selectedEntity.id;
}
