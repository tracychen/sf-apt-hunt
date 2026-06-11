"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  Coordinate,
  GeocodeAuthorization,
  ListingCandidate,
  ListingSearchResponse,
  MapPatchProposal,
  MapState,
} from "@/lib/domain/types";
import { seedMapState } from "@/lib/map/seed-data";
import { loadStoredOpenAiKey } from "@/lib/storage/api-key-storage";
import {
  canonicalizeGeocodeCacheQuery,
  clearMapState,
  loadGeocodeCache,
  loadMapState,
  saveGeocodeCacheEntry,
  saveMapState,
  type GeocodeCacheEntry,
} from "@/lib/storage/map-storage";
import type {
  SelectedMapEntity,
  VisibleMapLayers,
} from "@/components/apartment-map/leaflet-map";
import { Sidebar } from "@/components/apartment-map/sidebar";

type MapPanelProps = {
  mapState: MapState;
  listings: ListingCandidate[];
  selectedEntity: SelectedMapEntity;
  selectedZoneIds: string[];
  visibleLayers: VisibleMapLayers;
  onMapStateChange: (state: MapState) => void;
  onSelectedEntityChange: (entity: SelectedMapEntity) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
};

type ListingSearchMeta = Pick<ListingSearchResponse, "sourceSummary" | "citations" | "caveats"> | null;

const defaultVisibleLayers: VisibleMapLayers = {
  zones: true,
  corridors: true,
  targets: true,
  listings: true,
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
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<SelectedMapEntity>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [visibleLayers, setVisibleLayers] = useState<VisibleMapLayers>(defaultVisibleLayers);
  const [proposal, setProposal] = useState<MapPatchProposal | null>(null);
  const [listings, setListings] = useState<ListingCandidate[]>([]);
  const [listingSearchMeta, setListingSearchMeta] = useState<ListingSearchMeta>(null);
  const geocodeRunIdRef = useRef(0);
  const mapState = mapHistory.current;
  const canUndo = mapHistory.history.length > 0;

  useEffect(() => {
    const storedMapState = loadMapState();

    if (storedMapState) {
      dispatchMapHistory({ type: "hydrate", state: storedMapState });
    }

    const keyLoadTimeout = window.setTimeout(() => {
      const storedOpenAiKey = loadStoredOpenAiKey();
      setApiKey(storedOpenAiKey.key);
      setRemembered(storedOpenAiKey.remembered);
    }, 0);

    return () => window.clearTimeout(keyLoadTimeout);
  }, []);

  function updateMapState(nextState: MapState) {
    dispatchMapHistory({ type: "update", state: nextState });
    saveMapState(nextState);
  }

  const undoLastEdit = useCallback(() => {
    const previous = mapHistory.history.at(-1);
    if (!previous) {
      return;
    }

    dispatchMapHistory({ type: "undo" });
    saveMapState(previous);
  }, [mapHistory.history]);

  useEffect(() => {
    function handleKeyboardUndo(event: KeyboardEvent) {
      if (!isUndoKeyboardShortcut(event) || isEditableKeyboardTarget(event.target) || !canUndo) {
        return;
      }

      event.preventDefault();
      undoLastEdit();
    }

    window.addEventListener("keydown", handleKeyboardUndo);
    return () => window.removeEventListener("keydown", handleKeyboardUndo);
  }, [canUndo, undoLastEdit]);

  function resetLocalMap() {
    dispatchMapHistory({ type: "reset" });
    setSelectedEntity(null);
    setSelectedZoneIds([]);
    setProposal(null);
    clearMapState();
  }

  function resetSelectedShape() {
    if (!selectedEntity) {
      return;
    }

    const nextState = resetMapEntity(mapState, selectedEntity);

    updateMapState(nextState);
    if (selectedEntity.kind === "zone" && !seedMapState.zones.some((zone) => zone.id === selectedEntity.id)) {
      setSelectedZoneIds((ids) => ids.filter((id) => id !== selectedEntity.id));
      setSelectedEntity(null);
    }
  }

  function updateApiKey(nextApiKey: string | null, nextRemembered: boolean) {
    setApiKey(nextApiKey);
    setRemembered(nextRemembered);
  }

  function applyReviewedProposal(nextState: MapState) {
    updateMapState(nextState);
    setProposal(null);
  }

  function handleListingSearchResponse(response: ListingSearchResponse) {
    const nextRunId = geocodeRunIdRef.current + 1;
    geocodeRunIdRef.current = nextRunId;
    setListingSearchMeta({
      sourceSummary: response.sourceSummary,
      citations: response.citations,
      caveats: response.caveats,
    });
    setListings(response.candidates);

    const cachedResult = applyCachedGeocodeEntries(response.candidates);
    if (cachedResult.changed) {
      setListings(cachedResult.candidates);
    }

    if (!response.geocodeAuthorization) {
      return;
    }

    const candidatesToGeocode = selectCandidatesToGeocode(
      response.geocodeAuthorization,
      response.candidates,
      cachedResult.cachedCandidateIds,
    );

    if (candidatesToGeocode.length === 0) {
      return;
    }

    void geocodeListingCandidates({
      authorization: response.geocodeAuthorization,
      candidates: candidatesToGeocode,
      onResult: (candidateId, update) => {
        if (geocodeRunIdRef.current !== nextRunId) {
          return;
        }

        setListings((currentListings) =>
          currentListings.map((listing) =>
            listing.id === candidateId ? { ...listing, ...update } : listing,
          ),
        );
      },
    });
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-h-[58vh] border-b border-border lg:min-h-screen lg:border-b-0 lg:border-r">
        <LeafletMap
          mapState={mapState}
          listings={listings}
          selectedEntity={selectedEntity}
          selectedZoneIds={selectedZoneIds}
          visibleLayers={visibleLayers}
          onMapStateChange={updateMapState}
          onSelectedEntityChange={setSelectedEntity}
          onSelectedZoneIdsChange={setSelectedZoneIds}
        />
      </section>
      <Sidebar
        apiKey={apiKey}
        remembered={remembered}
        mapState={mapState}
        selectedEntity={selectedEntity}
        visibleLayers={visibleLayers}
        selectedZoneIds={selectedZoneIds}
        listings={listings}
        listingSearchMeta={listingSearchMeta}
        proposal={proposal}
        onApiKeyChange={updateApiKey}
        onVisibleLayersChange={setVisibleLayers}
        onListingSearchResponse={handleListingSearchResponse}
        onProposalChange={setProposal}
        onApplyProposal={applyReviewedProposal}
        onRejectProposal={() => setProposal(null)}
        onUndo={undoLastEdit}
        onReset={resetLocalMap}
        onResetSelectedShapes={resetSelectedShape}
        canUndo={canUndo}
        canResetSelectedShapes={selectedEntity !== null}
      />
    </main>
  );
}

function resetMapEntity(mapState: MapState, selectedEntity: NonNullable<SelectedMapEntity>) {
  switch (selectedEntity.kind) {
    case "zone": {
      const seedZone = seedMapState.zones.find((zone) => zone.id === selectedEntity.id);
      return {
        ...mapState,
        zones: seedZone
          ? mapState.zones.map((zone) => (zone.id === selectedEntity.id ? seedZone : zone))
          : mapState.zones.filter((zone) => zone.id !== selectedEntity.id),
      };
    }
    case "corridor": {
      const seedCorridor = seedMapState.corridors.find(
        (corridor) => corridor.id === selectedEntity.id,
      );
      return {
        ...mapState,
        corridors: seedCorridor
          ? mapState.corridors.map((corridor) =>
              corridor.id === selectedEntity.id ? seedCorridor : corridor,
            )
          : mapState.corridors.filter((corridor) => corridor.id !== selectedEntity.id),
      };
    }
    case "target": {
      const seedTarget = seedMapState.targets.find((target) => target.id === selectedEntity.id);
      return {
        ...mapState,
        targets: seedTarget
          ? mapState.targets.map((target) =>
              target.id === selectedEntity.id ? seedTarget : target,
            )
          : mapState.targets.filter((target) => target.id !== selectedEntity.id),
      };
    }
  }
}

function isUndoKeyboardShortcut(event: KeyboardEvent) {
  return (
    event.key.toLowerCase() === "z" &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey
  );
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest("input, textarea, select")) {
    return true;
  }

  const contentEditableTarget = target.closest("[contenteditable]");
  return contentEditableTarget !== null && contentEditableTarget.getAttribute("contenteditable") !== "false";
}

type GeocodeListingCandidateOptions = {
  authorization: GeocodeAuthorization;
  candidates: ListingCandidate[];
  onResult: (candidateId: string, update: Partial<ListingCandidate>) => void;
};

function applyCachedGeocodeEntries(candidates: ListingCandidate[]) {
  const cache = loadGeocodeCache();
  const cachedCandidateIds = new Set<string>();
  let changed = false;
  const cachedCandidates = candidates.map((candidate) => {
    if (!candidate.geocodeQuery) {
      return candidate;
    }

    const cacheEntry = cache[canonicalizeGeocodeCacheQuery(candidate.geocodeQuery)];
    if (!cacheEntry) {
      return candidate;
    }

    cachedCandidateIds.add(candidate.id);
    const cachedCandidate = applyCachedGeocodeEntry(candidate, cacheEntry);
    changed = changed || cachedCandidate !== candidate;
    return cachedCandidate;
  });

  return {
    cachedCandidateIds,
    candidates: cachedCandidates,
    changed,
  };
}

function applyCachedGeocodeEntry(
  candidate: ListingCandidate,
  entry: GeocodeCacheEntry,
): ListingCandidate {
  if ("coordinates" in entry) {
    return {
      ...candidate,
      coordinates: entry.coordinates,
      geocodeStatus:
        entry.markerPrecision === "exact" ? "geocoded_exact" : "geocoded_approximate",
      markerPrecision: entry.markerPrecision,
    };
  }

  return {
    ...candidate,
    geocodeStatus: entry.status,
  };
}

function selectCandidatesToGeocode(
  authorization: GeocodeAuthorization,
  candidates: ListingCandidate[],
  cachedCandidateIds: Set<string>,
) {
  const allowedCandidateIds = new Set(
    authorization.allowedQueries.map((allowedQuery) => allowedQuery.candidateId),
  );

  return candidates
    .filter(
      (candidate) =>
        Boolean(candidate.geocodeQuery) &&
        allowedCandidateIds.has(candidate.id) &&
        !cachedCandidateIds.has(candidate.id),
    )
    .slice(0, authorization.maxAttempts);
}

async function geocodeListingCandidates({
  authorization,
  candidates,
  onResult,
}: GeocodeListingCandidateOptions) {
  const sessionId = getGeocodeSessionId();

  for (const candidate of candidates) {
    if (!candidate.geocodeQuery) {
      continue;
    }

    try {
      const response = await fetch("/api/geocode/listing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sf-apt-session": sessionId,
        },
        body: JSON.stringify({
          nonce: authorization.nonce,
          candidateId: candidate.id,
          geocodeQuery: candidate.geocodeQuery,
        }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (response.ok && isSuccessfulGeocodeResponse(body)) {
        saveGeocodeCacheEntry(candidate.geocodeQuery, {
          coordinates: body.geocode.coordinates,
          markerPrecision: body.geocode.markerPrecision,
        });
        onResult(candidate.id, {
          coordinates: body.geocode.coordinates,
          geocodeStatus:
            body.geocode.markerPrecision === "exact"
              ? "geocoded_exact"
              : "geocoded_approximate",
          markerPrecision: body.geocode.markerPrecision,
        });
        continue;
      }

      const status = readFailedGeocodeStatus(body);
      if (status) {
        saveGeocodeCacheEntry(candidate.geocodeQuery, {
          status,
          error: readGeocodeError(body),
        });
      }
      onResult(candidate.id, { geocodeStatus: status ?? "failed" });
    } catch {
      onResult(candidate.id, { geocodeStatus: "failed" });
    }
  }
}

function getGeocodeSessionId() {
  const storageKey = "sf-apt-hunt:geocode-session:v1";

  try {
    const existingSessionId = window.sessionStorage.getItem(storageKey);
    if (existingSessionId) {
      return existingSessionId;
    }

    const nextSessionId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `session-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(storageKey, nextSessionId);
    return nextSessionId;
  } catch {
    return "session-unavailable";
  }
}

function isSuccessfulGeocodeResponse(value: unknown): value is {
  ok: true;
  geocode: {
    status: "ok";
    coordinates: Coordinate;
    markerPrecision: "exact" | "approximate";
  };
} {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.geocode)) {
    return false;
  }

  const coordinates = value.geocode.coordinates;
  return (
    value.geocode.status === "ok" &&
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)) &&
    (value.geocode.markerPrecision === "exact" ||
      value.geocode.markerPrecision === "approximate")
  );
}

function readFailedGeocodeStatus(value: unknown): "failed" | "outside_sf" | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.status === "failed" || value.status === "outside_sf") {
    return value.status;
  }

  return null;
}

function readGeocodeError(value: unknown) {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }

  return "Geocoding request failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
