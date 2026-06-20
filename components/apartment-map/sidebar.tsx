"use client";

import { type ChangeEvent, useRef, useState } from "react";

import type {
  GeocodeAuthorization,
  ListingDisplayCandidate,
  ListingLead,
  MapState,
  PlanningContextSummary,
} from "@/lib/domain/types";
import type {
  SelectedMapEntity,
  VisibleMapLayers,
} from "@/components/apartment-map/leaflet-map";
import { ApiKeyDialog } from "@/components/apartment-map/api-key-dialog";
import { CorridorEditor } from "@/components/apartment-map/corridor-editor";
import { PlanningChatPanel } from "@/components/apartment-map/planning-chat-panel";
import { TargetEditor } from "@/components/apartment-map/target-editor";
import { Button } from "@/components/ui/button";
import { mapStateSchema } from "@/lib/domain/schemas";
import { formatTargetLabel } from "@/lib/map/target-points";

export function Sidebar({
  apiKey,
  remembered,
  mapState,
  selectedEntity,
  visibleLayers,
  selectedZoneIds,
  listings,
  planningResetToken,
  onApiKeyChange,
  onDeselectSelectedEntity,
  onImportMapState,
  onMapStateChange,
  onPlanningListingLeadChange,
  onVisibleLayersChange,
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
  listings: ListingDisplayCandidate[];
  planningResetToken: number;
  onApiKeyChange: (key: string | null, remembered: boolean) => void;
  onDeselectSelectedEntity: () => void;
  onImportMapState: (state: MapState) => void;
  onMapStateChange: (state: MapState) => void;
  onPlanningListingLeadChange: (input: {
    lead: ListingLead;
    contextSummary: PlanningContextSummary | null;
    geocodeAuthorization: GeocodeAuthorization | null;
  }) => void;
  onVisibleLayersChange: (layers: VisibleMapLayers) => void;
  onUndo: () => void;
  onReset: () => void;
  onResetSelectedShapes: () => void;
  canUndo: boolean;
  canResetSelectedShapes: boolean;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    mapState: MapState;
  } | null>(null);
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
      setWorkspaceStatus("Copied local map JSON.");
    } catch {
      setWorkspaceStatus("Could not copy local map JSON.");
    }
  }

  function openImportPicker() {
    importInputRef.current?.click();
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const result = mapStateSchema.safeParse(parsed);

      if (!result.success) {
        setPendingImport(null);
        setWorkspaceStatus("Import failed. Choose a valid SF Apartment Hunt map JSON file.");
        return;
      }

      const fileName = file.name.trim() || "selected file";
      setPendingImport({ fileName, mapState: result.data });
      setWorkspaceStatus(`Ready to import ${fileName}.`);
    } catch {
      setPendingImport(null);
      setWorkspaceStatus("Import failed. Choose a valid JSON file.");
    }
  }

  function replaceCurrentMap() {
    if (!pendingImport) {
      return;
    }

    onImportMapState(pendingImport.mapState);
    setWorkspaceStatus(`Imported ${pendingImport.fileName}.`);
    setPendingImport(null);
  }

  function cancelImport() {
    setPendingImport(null);
    setWorkspaceStatus("Map import canceled.");
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
        <Button disabled={!selectedEntity} variant="outline" onClick={onDeselectSelectedEntity}>
          Deselect
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
        <Button variant="outline" onClick={openImportPicker}>
          Import map JSON
        </Button>
        <input
          ref={importInputRef}
          aria-label="Import map JSON file"
          accept=".json,application/json"
          className="sr-only"
          onChange={handleImportFileChange}
          type="file"
        />
      </div>
      {pendingImport ? (
        <div className="border-b border-sidebar-border bg-background px-3 py-2 text-xs">
          <p className="font-medium">Importing this file will replace the current map.</p>
          <p className="mt-1 text-muted-foreground">
            Review saved versions before continuing. Current pins, corridors, zones, chat, and staged
            listings will be cleared from this workspace.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={replaceCurrentMap}>
              Replace current map
            </Button>
            <Button size="sm" variant="outline" onClick={cancelImport}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

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
          {workspaceStatus ? <p className="mt-3 text-xs text-muted-foreground">{workspaceStatus}</p> : null}
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
        <PlanningChatPanel
          apiKey={apiKey}
          mapState={mapState}
          selectedEntity={selectedEntity}
          selectedZoneIds={selectedZoneIds}
          visibleLayers={visibleLayers}
          resetToken={planningResetToken}
          onMapStateChange={onMapStateChange}
          onPlanningListingLeadChange={onPlanningListingLeadChange}
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
