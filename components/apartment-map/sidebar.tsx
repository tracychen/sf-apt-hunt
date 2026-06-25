"use client";

import { type ChangeEvent, useRef, useState } from "react";

import type {
  GeocodeAuthorization,
  ListingDisplayCandidate,
  ListingLead,
  MapState,
  PlanningContextSummary,
} from "@/lib/domain/types";
import type { PlanningThreadCache } from "@/lib/storage/planning-chat-storage";
import type {
  SelectedMapEntity,
  VisibleMapLayers,
} from "@/components/apartment-map/leaflet-map";
import { ApiKeyDialog } from "@/components/apartment-map/api-key-dialog";
import { AreaEditor } from "@/components/apartment-map/area-editor";
import { CorridorEditor } from "@/components/apartment-map/corridor-editor";
import {
  PlanningChatPanel,
  type PlanningChatOnboardingMilestone,
} from "@/components/apartment-map/planning-chat-panel";
import {
  TargetEditor,
  type AnchorSemanticEdit,
} from "@/components/apartment-map/target-editor";
import { Button } from "@/components/ui/button";
import { mapStateSchema } from "@/lib/domain/schemas";
import { formatTargetLabel } from "@/lib/map/target-points";

type SidebarNotice =
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | null;

export function Sidebar({
  ownershipMode,
  apiKey,
  remembered,
  mapState,
  selectedEntity,
  visibleLayers,
  selectedZoneIds,
  listings,
  planningResetToken,
  planningOwnershipMode,
  sidebarNotice,
  onApiKeyChange,
  onDeselectSelectedEntity,
  onImportMapState,
  onMapStateChange,
  onAnchorSemanticEdit,
  onPlanningChatOnboardingMilestone,
  onPlanningMapStateChange,
  onPlanningListingLeadChange,
  onVisibleLayersChange,
  onUndo,
  onReset,
  onResetSelectedShapes,
  canUndo,
  canResetSelectedShapes,
}: {
  ownershipMode: "local" | "workspace";
  apiKey: string | null;
  remembered: boolean;
  mapState: MapState;
  selectedEntity: SelectedMapEntity;
  visibleLayers: VisibleMapLayers;
  selectedZoneIds: string[];
  listings: ListingDisplayCandidate[];
  planningResetToken: number;
  planningOwnershipMode:
    | { kind: "local" }
    | {
        kind: "workspace";
        mapRevision: string;
        listingLedgerRevision: string;
        invalidatedActionIds: string[];
        threadCache: PlanningThreadCache | null;
      };
  sidebarNotice: SidebarNotice;
  onApiKeyChange: (key: string | null, remembered: boolean) => void;
  onDeselectSelectedEntity: () => void;
  onImportMapState: (state: MapState) => boolean | Promise<boolean>;
  onMapStateChange: (state: MapState) => void;
  onAnchorSemanticEdit: (edit: AnchorSemanticEdit) => void;
  onPlanningChatOnboardingMilestone: (milestone: PlanningChatOnboardingMilestone) => void;
  onPlanningMapStateChange: (input: {
    mapState: MapState;
    mapRevision?: string | null;
  }) => void;
  onPlanningListingLeadChange: (input: {
    lead: ListingLead;
    contextSummary: PlanningContextSummary | null;
    geocodeAuthorization: GeocodeAuthorization | null;
    listingLedgerRevision?: string | null;
  }) => void;
  onVisibleLayersChange: (layers: VisibleMapLayers) => void;
  onUndo: () => void;
  onReset: () => boolean | Promise<boolean>;
  onResetSelectedShapes: () => void;
  canUndo: boolean;
  canResetSelectedShapes: boolean;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    mapState: MapState;
  } | null>(null);
  const isWorkspaceMode = ownershipMode === "workspace";
  const selectedCorridor =
    selectedEntity?.kind === "corridor"
      ? mapState.corridors.find((corridor) => corridor.id === selectedEntity.id) ?? null
      : null;
  const selectedTarget =
    selectedEntity?.kind === "target"
      ? mapState.targets.find((target) => target.id === selectedEntity.id) ?? null
      : null;
  const selectedArea =
    selectedEntity?.kind === "area"
      ? (mapState.areas ?? []).find((area) => area.id === selectedEntity.id) ?? null
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
      setWorkspaceStatus(isWorkspaceMode ? "Copied workspace map JSON." : "Copied local map JSON.");
    } catch {
      setWorkspaceStatus(
        isWorkspaceMode ? "Could not copy workspace map JSON." : "Could not copy local map JSON.",
      );
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

  async function replaceCurrentMap() {
    if (!pendingImport) {
      return;
    }

    setIsImporting(true);

    try {
      const succeeded = await onImportMapState(pendingImport.mapState);
      if (!succeeded) {
        return;
      }

      setWorkspaceStatus(`Imported ${pendingImport.fileName}.`);
      setPendingImport(null);
    } finally {
      setIsImporting(false);
    }
  }

  function cancelImport() {
    setPendingImport(null);
    setWorkspaceStatus("Map import canceled.");
  }

  async function handleReset() {
    setIsResetting(true);

    try {
      await onReset();
    } finally {
      setIsResetting(false);
    }
  }

  const importConfirmationMessage = isWorkspaceMode
    ? "Review saved versions before continuing. Current pins, corridors, and zones will be replaced in this workspace. Pending reviewed map actions for the old revision will be disabled."
    : "Review saved versions before continuing. Current pins, corridors, zones, chat, and staged listings will be cleared from this workspace.";
  const visibleNotice =
    sidebarNotice ?? (workspaceStatus ? { kind: "info", message: workspaceStatus } : null);

  return (
    <aside className="flex min-h-[42vh] flex-col bg-sidebar text-sidebar-foreground lg:max-h-screen lg:min-h-screen lg:overflow-y-auto">
      <div className="border-b border-sidebar-border p-4">
        <p className="text-xs uppercase text-muted-foreground">
          {isWorkspaceMode ? "Signed-in workspace" : "Local-first workspace"}
        </p>
        <h1 className="mt-1 text-xl font-semibold">SF Apartment Hunt</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {mapState.zones.length} neighborhoods, {(mapState.areas ?? []).length} areas,{" "}
          {listings.length} listings staged.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Selected item: {describeSelectedEntity(selectedEntity, mapState)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-sidebar-border p-3">
        <Button disabled={!canUndo} variant="outline" onClick={onUndo}>
          Undo
        </Button>
        <Button disabled={!selectedEntity} variant="outline" onClick={onDeselectSelectedEntity}>
          Deselect item
        </Button>
        <Button disabled={!canResetSelectedShapes} variant="outline" onClick={onResetSelectedShapes}>
          Reset selected item
        </Button>
        <Button disabled={isResetting} variant="outline" onClick={() => void handleReset()}>
          {isWorkspaceMode ? "Reset workspace map" : "Reset local map"}
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
          <p className="mt-1 text-muted-foreground">{importConfirmationMessage}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={isImporting} size="sm" onClick={() => void replaceCurrentMap()}>
              Replace current map
            </Button>
            <Button disabled={isImporting} size="sm" variant="outline" onClick={cancelImport}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 p-4">
        <section
          className="border border-sidebar-border bg-background p-3 text-sm"
          data-onboarding-target="map-layers"
        >
          <h2 className="font-medium">Map layers</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            {(["zones", "areas", "corridors", "targets", "listings"] as const).map((layer) => (
              <label key={layer} className="flex items-center gap-2">
                <input
                  className="size-3.5"
                  type="checkbox"
                  checked={visibleLayers[layer]}
                  onChange={() => toggleLayer(layer)}
                />
                {formatLayerLabel(layer)}
              </label>
            ))}
          </div>
          {visibleNotice ? (
            <p
              className={
                visibleNotice.kind === "error"
                  ? "mt-3 text-xs text-destructive"
                  : "mt-3 text-xs text-muted-foreground"
              }
            >
              {visibleNotice.message}
            </p>
          ) : null}
        </section>

        {selectedTarget ? (
          <TargetEditor
            mapState={mapState}
            target={selectedTarget}
            onMapStateChange={onMapStateChange}
            onSemanticEdit={onAnchorSemanticEdit}
          />
        ) : null}

        {selectedArea ? (
          <AreaEditor
            area={selectedArea}
            mapState={mapState}
            onMapStateChange={onMapStateChange}
            onSemanticEdit={onAnchorSemanticEdit}
          />
        ) : null}

        {selectedCorridor ? (
          <CorridorEditor
            corridor={selectedCorridor}
            mapState={mapState}
            onMapStateChange={onMapStateChange}
            onSemanticEdit={onAnchorSemanticEdit}
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
          ownershipMode={planningOwnershipMode}
          selectedEntity={selectedEntity}
          selectedZoneIds={selectedZoneIds}
          visibleLayers={visibleLayers}
          resetToken={planningResetToken}
          onPlanningMapStateChange={onPlanningMapStateChange}
          onPlanningListingLeadChange={onPlanningListingLeadChange}
          onOnboardingMilestone={onPlanningChatOnboardingMilestone}
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

  if (selectedEntity.kind === "area") {
    return (mapState.areas ?? []).find((area) => area.id === selectedEntity.id)?.name ?? selectedEntity.id;
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

function formatLayerLabel(layer: keyof VisibleMapLayers) {
  if (layer === "zones") {
    return "Neighborhoods";
  }

  return `${layer[0].toUpperCase()}${layer.slice(1)}`;
}
