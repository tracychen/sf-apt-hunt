"use client";

import { useEffect, useReducer, useState } from "react";
import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { applyProposal } from "@/lib/map/proposals";
import { seedMapState } from "@/lib/map/seed-data";
import { clearMapState, loadMapState, saveMapState } from "@/lib/storage/map-storage";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/apartment-map/sidebar";

type MapPanelProps = {
  mapState: MapState;
  listings: ListingCandidate[];
  selectedZoneIds: string[];
  onMapStateChange: (state: MapState) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
};

type MapHistoryState = {
  current: MapState;
  history: MapState[];
};

type MapHistoryAction =
  | { type: "hydrate"; state: MapState }
  | { type: "update"; state: MapState }
  | { type: "undo" }
  | { type: "reset" };

function pushHistory(history: MapState[], current: MapState) {
  return [...history.slice(-19), current];
}

function mapHistoryReducer(state: MapHistoryState, action: MapHistoryAction): MapHistoryState {
  switch (action.type) {
    case "hydrate":
      return { ...state, current: action.state };
    case "update":
      return {
        current: action.state,
        history: pushHistory(state.history, state.current),
      };
    case "undo": {
      const previous = state.history.at(-1);

      if (!previous) {
        return state;
      }

      return {
        current: previous,
        history: state.history.slice(0, -1),
      };
    }
    case "reset":
      return {
        current: seedMapState,
        history: pushHistory(state.history, state.current),
      };
  }
}

function priorityTone(priority: "high" | "medium" | "low") {
  if (priority === "high") {
    return "border-primary bg-primary/10 text-foreground";
  }

  if (priority === "medium") {
    return "border-chart-3 bg-chart-3/10 text-foreground";
  }

  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function PlaceholderMapPanel(props: MapPanelProps) {
  const { mapState, listings, selectedZoneIds, onSelectedZoneIdsChange } = props;
  const selectedZoneSet = new Set(selectedZoneIds);
  const listingPins = listings.filter((listing) => listing.coordinates !== null);

  function toggleZone(zoneId: string) {
    onSelectedZoneIdsChange(
      selectedZoneSet.has(zoneId)
        ? selectedZoneIds.filter((id) => id !== zoneId)
        : [...selectedZoneIds, zoneId],
    );
  }

  return (
    <div className="flex h-full min-h-[58vh] flex-col bg-background lg:min-h-screen">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Map shell</p>
          <h2 className="text-lg font-semibold">Apartment search zones</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelectedZoneIdsChange(mapState.zones.map((zone) => zone.id))}
          >
            Select all zones
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSelectedZoneIdsChange([])}>
            Clear selection
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mapState.zones.map((zone) => {
              const selected = selectedZoneSet.has(zone.id);

              return (
                <Button
                  key={zone.id}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  className="h-auto min-h-36 w-full flex-col items-start justify-between gap-4 whitespace-normal p-3 text-left"
                  onClick={() => toggleZone(zone.id)}
                >
                  <span className="flex w-full items-start justify-between gap-3">
                    <span className="text-sm font-semibold">{zone.name}</span>
                    <span className="shrink-0 border border-current px-1.5 py-0.5 text-[10px] uppercase">
                      {zone.kind}
                    </span>
                  </span>
                  <span className="grid w-full grid-cols-3 gap-2 text-[11px]">
                    <span>
                      Fit
                      <strong className="block text-sm">{zone.fitnessScore}/5</strong>
                    </span>
                    <span>
                      Rent
                      <strong className="block text-sm">{zone.affordabilityScore}/5</strong>
                    </span>
                    <span>
                      Transit
                      <strong className="block text-sm">{zone.carFreeScore}/5</strong>
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs opacity-80">{zone.notes[0]}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-border bg-sidebar p-4 text-sidebar-foreground lg:border-l lg:border-t-0">
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Selected zones</p>
              <p className="mt-1 text-2xl font-semibold">{selectedZoneIds.length}</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Priority corridors</p>
              {mapState.corridors.map((corridor) => (
                <div
                  key={corridor.id}
                  className={`border px-2 py-1.5 text-xs ${priorityTone(corridor.priority)}`}
                >
                  <div className="font-medium">{corridor.name}</div>
                  <div className="mt-1 uppercase">{corridor.priority}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Targets</p>
              {mapState.targets.map((target) => (
                <div key={target.id} className="border border-border bg-background px-2 py-1.5 text-xs">
                  <div className="font-medium">{target.name}</div>
                  <div className="mt-1 text-muted-foreground">{target.priority} priority</div>
                </div>
              ))}
            </div>

            <div className="border border-border bg-background p-3 text-xs text-muted-foreground">
              <p>Boundaries are approximate apartment-search zones, not official boundaries.</p>
              <p className="mt-2">
                {listingPins.length} listing {listingPins.length === 1 ? "pin" : "pins"} ready for the
                Leaflet map.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ApartmentMapApp() {
  const [mapHistory, dispatchMapHistory] = useReducer(mapHistoryReducer, {
    current: seedMapState,
    history: [],
  });
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<MapPatchProposal | null>(null);
  const [listings, setListings] = useState<ListingCandidate[]>([]);
  const mapState = mapHistory.current;
  const canUndo = mapHistory.history.length > 0;

  useEffect(() => {
    const storedMapState = loadMapState();

    if (storedMapState) {
      dispatchMapHistory({ type: "hydrate", state: storedMapState });
    }
  }, []);

  function updateMapState(nextState: MapState) {
    dispatchMapHistory({ type: "update", state: nextState });
    saveMapState(nextState);
  }

  function undoLastEdit() {
    const previous = mapHistory.history.at(-1);
    if (!previous) {
      return;
    }

    dispatchMapHistory({ type: "undo" });
    saveMapState(previous);
  }

  function resetLocalMap() {
    dispatchMapHistory({ type: "reset" });
    setSelectedZoneIds([]);
    setProposal(null);
    clearMapState();
  }

  function applyCurrentProposal() {
    if (!proposal) {
      return;
    }

    const result = applyProposal(mapState, proposal);
    if (!result.ok) {
      return;
    }

    updateMapState(result.state);
    setProposal(null);
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-h-[58vh] border-b border-border lg:min-h-screen lg:border-b-0 lg:border-r">
        <PlaceholderMapPanel
          mapState={mapState}
          listings={listings}
          selectedZoneIds={selectedZoneIds}
          onMapStateChange={updateMapState}
          onSelectedZoneIdsChange={setSelectedZoneIds}
        />
      </section>
      <Sidebar
        mapState={mapState}
        selectedZoneIds={selectedZoneIds}
        listings={listings}
        proposal={proposal}
        onListingsChange={setListings}
        onProposalChange={setProposal}
        onApplyProposal={applyCurrentProposal}
        onRejectProposal={() => setProposal(null)}
        onUndo={undoLastEdit}
        onReset={resetLocalMap}
        canUndo={canUndo}
      />
    </main>
  );
}
