"use client";

import dynamic from "next/dynamic";
import { useEffect, useReducer, useState } from "react";
import type { ListingCandidate, MapPatchProposal, MapState } from "@/lib/domain/types";
import { applyProposal } from "@/lib/map/proposals";
import { seedMapState } from "@/lib/map/seed-data";
import { clearMapState, loadMapState, saveMapState } from "@/lib/storage/map-storage";
import { Sidebar } from "@/components/apartment-map/sidebar";

type MapPanelProps = {
  mapState: MapState;
  listings: ListingCandidate[];
  selectedZoneIds: string[];
  onMapStateChange: (state: MapState) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
};

const LeafletMap = dynamic<MapPanelProps>(
  () => import("@/components/apartment-map/leaflet-map").then((module) => module.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[58vh] items-center justify-center bg-background text-sm text-muted-foreground lg:min-h-screen">
        Loading map...
      </div>
    ),
  },
);

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
        <LeafletMap
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
