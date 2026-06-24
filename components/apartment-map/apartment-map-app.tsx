"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  Coordinate,
  GeocodeAuthorization,
  ListingDisplayCandidate,
  ListingLead,
  ListingSearchFilters,
  MapState,
  PlanningContextSummary,
} from "@/lib/domain/types";
import {
  compareListingDisplayCandidates,
  scoreListingLead,
} from "@/lib/map/listing-planning-score";
import { seedMapState } from "@/lib/map/seed-data";
import { loadStoredOpenAiKey } from "@/lib/storage/api-key-storage";
import {
  clearListingLedger,
  updateListingLeadCandidate,
} from "@/lib/storage/listing-ledger-storage";
import {
  clearMapState,
  canonicalizeGeocodeCacheQuery,
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
  listings: ListingDisplayCandidate[];
  selectedEntity: SelectedMapEntity;
  selectedZoneIds: string[];
  visibleLayers: VisibleMapLayers;
  onMapStateChange: (state: MapState) => void;
  onSelectedEntityChange: (entity: SelectedMapEntity) => void;
  onSelectedZoneIdsChange: (ids: string[]) => void;
};

export const defaultVisibleLayers: VisibleMapLayers = {
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

export type MapHistoryState = {
  current: MapState;
  history: MapState[];
};

export type MapHistoryAction =
  | { type: "hydrate"; state: MapState }
  | { type: "update"; state: MapState }
  | { type: "undo" }
  | { type: "reset" };

function pushHistory(history: MapState[], current: MapState) {
  return [...history.slice(-19), current];
}

export function mapHistoryReducer(state: MapHistoryState, action: MapHistoryAction): MapHistoryState {
  switch (action.type) {
    case "hydrate":
      return { current: action.state, history: [] };
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

export function ApartmentMapViewport({
  mapState,
  listings,
  selectedEntity,
  selectedZoneIds,
  visibleLayers,
  onMapStateChange,
  onSelectedEntityChange,
  onSelectedZoneIdsChange,
}: MapPanelProps) {
  return (
    <section className="min-h-[58vh] border-b border-border lg:min-h-screen lg:border-b-0 lg:border-r">
      <LeafletMap
        mapState={mapState}
        listings={listings}
        selectedEntity={selectedEntity}
        selectedZoneIds={selectedZoneIds}
        visibleLayers={visibleLayers}
        onMapStateChange={onMapStateChange}
        onSelectedEntityChange={onSelectedEntityChange}
        onSelectedZoneIdsChange={onSelectedZoneIdsChange}
      />
    </section>
  );
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
  const [listingLeads, setListingLeads] = useState<ListingLead[]>([]);
  const [activeListingFilters, setActiveListingFilters] = useState<ListingSearchFilters | null>(null);
  const [planningResetToken, setPlanningResetToken] = useState(0);
  const geocodeRunIdRef = useRef(0);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const mapState = mapHistory.current;
  const canUndo = mapHistory.history.length > 0;
  const listings = useMemo(
    () =>
      activeListingFilters
        ? scoreAndSortListingLeads({
            leads: listingLeads,
            filters: activeListingFilters,
            mapState,
            selectedZoneIds,
          })
        : [],
    [activeListingFilters, listingLeads, mapState, selectedZoneIds],
  );

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
      if (
        event.key === "Escape" &&
        selectedEntity &&
        !isEditableKeyboardTarget(event.target)
      ) {
        event.preventDefault();
        setSelectedEntity(null);
        return;
      }

      if (!isUndoKeyboardShortcut(event) || isEditableKeyboardTarget(event.target) || !canUndo) {
        return;
      }

      event.preventDefault();
      undoLastEdit();
    }

    window.addEventListener("keydown", handleKeyboardUndo);
    return () => window.removeEventListener("keydown", handleKeyboardUndo);
  }, [canUndo, selectedEntity, undoLastEdit]);

  function resetLocalMap() {
    dispatchMapHistory({ type: "reset" });
    geocodeRunIdRef.current += 1;
    geocodeAbortRef.current?.abort();
    setSelectedEntity(null);
    setSelectedZoneIds([]);
    setListingLeads([]);
    setActiveListingFilters(null);
    setPlanningResetToken((current) => current + 1);
    clearListingLedger();
    clearMapState();
    return true;
  }

  function importMapState(nextState: MapState) {
    updateMapState(nextState);
    geocodeRunIdRef.current += 1;
    geocodeAbortRef.current?.abort();
    setSelectedEntity(null);
    setSelectedZoneIds([]);
    setListingLeads([]);
    setActiveListingFilters(null);
    setPlanningResetToken((current) => current + 1);
    clearListingLedger();
    return true;
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

    if (
      selectedEntity.kind === "corridor" &&
      !seedMapState.corridors.some((corridor) => corridor.id === selectedEntity.id)
    ) {
      setSelectedEntity(null);
    }

    if (
      selectedEntity.kind === "target" &&
      !seedMapState.targets.some((target) => target.id === selectedEntity.id)
    ) {
      setSelectedEntity(null);
    }
  }

  function updateApiKey(nextApiKey: string | null, nextRemembered: boolean) {
    setApiKey(nextApiKey);
    setRemembered(nextRemembered);
  }

  function handlePlanningListingLeadChange({
    lead,
    contextSummary,
    geocodeAuthorization,
  }: {
    lead: ListingLead;
    contextSummary: PlanningContextSummary | null;
    geocodeAuthorization: GeocodeAuthorization | null;
  }) {
    if (lead.status === "dismissed") {
      geocodeRunIdRef.current += 1;
      geocodeAbortRef.current?.abort();
      setListingLeads((current) =>
        current.filter((currentLead) => currentLead.canonicalUrl !== lead.canonicalUrl),
      );
      return;
    }

    const cachedResult = lead.status === "saved" ? applyCachedGeocodeEntries([lead]) : null;
    const nextLead = cachedResult?.leads[0] ?? lead;

    setListingLeads((current) => upsertListingLead(current, nextLead));

    if (lead.status === "saved") {
      if (contextSummary) {
        setActiveListingFilters(planningFiltersFromContextSummary(contextSummary));
      }

      if (!geocodeAuthorization) {
        return;
      }

      const candidatesToGeocode = selectCandidatesToGeocode(
        geocodeAuthorization,
        [nextLead.candidate],
        cachedResult?.cachedCandidateIds ?? new Set<string>(),
      );

      if (candidatesToGeocode.length === 0) {
        return;
      }

      const nextRunId = geocodeRunIdRef.current + 1;
      geocodeRunIdRef.current = nextRunId;
      geocodeAbortRef.current?.abort();
      const abortController = new AbortController();
      geocodeAbortRef.current = abortController;

      void geocodeListingCandidates({
        authorization: geocodeAuthorization,
        candidates: candidatesToGeocode,
        signal: abortController.signal,
        onResult: (candidateId, update) => {
          if (geocodeRunIdRef.current !== nextRunId) {
            return;
          }

          setListingLeads((currentLeads) =>
            currentLeads.map((currentLead) => {
              if (currentLead.candidate.id !== candidateId) {
                return currentLead;
              }

              const updatedCandidate = {
                ...currentLead.candidate,
                ...update,
              };
              const updatedLead = updateListingLeadCandidate(
                currentLead.canonicalUrl,
                updatedCandidate,
              );

              return updatedLead ?? {
                ...currentLead,
                candidate: updatedCandidate,
              };
            }),
          );
        },
      });
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_420px]">
      <ApartmentMapViewport
        mapState={mapState}
        listings={listings}
        selectedEntity={selectedEntity}
        selectedZoneIds={selectedZoneIds}
        visibleLayers={visibleLayers}
        onMapStateChange={updateMapState}
        onSelectedEntityChange={setSelectedEntity}
        onSelectedZoneIdsChange={setSelectedZoneIds}
      />
      <Sidebar
        ownershipMode="local"
        apiKey={apiKey}
        remembered={remembered}
        mapState={mapState}
        selectedEntity={selectedEntity}
        visibleLayers={visibleLayers}
        selectedZoneIds={selectedZoneIds}
        listings={listings}
        planningResetToken={planningResetToken}
        planningOwnershipMode={{ kind: "local" }}
        sidebarNotice={null}
        onApiKeyChange={updateApiKey}
        onDeselectSelectedEntity={() => setSelectedEntity(null)}
        onImportMapState={importMapState}
        onMapStateChange={updateMapState}
        onPlanningMapStateChange={({ mapState: nextMapState }) => updateMapState(nextMapState)}
        onPlanningListingLeadChange={handlePlanningListingLeadChange}
        onVisibleLayersChange={setVisibleLayers}
        onUndo={undoLastEdit}
        onReset={resetLocalMap}
        onResetSelectedShapes={resetSelectedShape}
        canUndo={canUndo}
        canResetSelectedShapes={selectedEntity !== null}
      />
    </main>
  );
}

export function resetMapEntity(
  mapState: MapState,
  selectedEntity: NonNullable<SelectedMapEntity>,
) {
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

export function isUndoKeyboardShortcut(event: KeyboardEvent) {
  return (
    event.key.toLowerCase() === "z" &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest("input, textarea, select")) {
    return true;
  }

  const contentEditableTarget = target.closest("[contenteditable]");
  return contentEditableTarget !== null && contentEditableTarget.getAttribute("contenteditable") !== "false";
}

type ScoreAndSortListingLeadsOptions = {
  leads: ListingLead[];
  filters: ListingSearchFilters;
  mapState: MapState;
  selectedZoneIds: string[];
};

export function scoreAndSortListingLeads({
  leads,
  filters,
  mapState,
  selectedZoneIds,
}: ScoreAndSortListingLeadsOptions) {
  return leads
    .map((lead) => scoreListingLead({ lead, filters, mapState, selectedZoneIds }))
    .sort(compareListingDisplayCandidates);
}

export function upsertListingLead(current: ListingLead[], nextLead: ListingLead) {
  const existingIndex = current.findIndex(
    (lead) => lead.canonicalUrl === nextLead.canonicalUrl,
  );

  if (existingIndex === -1) {
    return [nextLead, ...current];
  }

  const next = [...current];
  next[existingIndex] = nextLead;
  return next;
}

export function planningFiltersFromContextSummary(
  contextSummary: PlanningContextSummary,
): ListingSearchFilters {
  return {
    maxBudget: contextSummary.budget,
    beds: contextSummary.beds ?? "any",
    timing: contextSummary.timing ?? "",
    shortTerm: contextSummary.shortTerm ?? false,
    furnished: contextSummary.furnished ?? false,
  };
}

type GeocodeListingCandidateOptions = {
  authorization: GeocodeAuthorization;
  candidates: Array<ListingLead["candidate"]>;
  signal?: AbortSignal;
  onResult: (
    candidateId: string,
    update: Partial<ListingLead["candidate"]>,
  ) => void | Promise<void>;
};

export function applyCachedGeocodeEntries(leads: ListingLead[]) {
  const cache = loadGeocodeCache();
  const cachedCandidateIds = new Set<string>();
  const cachedLeads = leads.map((lead) => {
    if (!lead.candidate.geocodeQuery) {
      return lead;
    }

    const cacheEntry = cache[canonicalizeGeocodeCacheQuery(lead.candidate.geocodeQuery)];
    if (!cacheEntry) {
      return lead;
    }

    cachedCandidateIds.add(lead.candidate.id);
    const cachedCandidate = applyCachedGeocodeEntry(lead.candidate, cacheEntry);
    const cachedLead = updateListingLeadCandidate(lead.canonicalUrl, cachedCandidate);

    return cachedLead ?? { ...lead, candidate: cachedCandidate };
  });

  return {
    cachedCandidateIds,
    leads: cachedLeads,
  };
}

function applyCachedGeocodeEntry(
  candidate: ListingLead["candidate"],
  entry: GeocodeCacheEntry,
): ListingLead["candidate"] {
  if ("coordinates" in entry) {
    return {
      ...candidate,
      coordinates: entry.coordinates,
      geocodeStatus: entry.markerPrecision === "exact" ? "geocoded_exact" : "geocoded_approximate",
      markerPrecision: entry.markerPrecision,
    };
  }

  return {
    ...candidate,
    geocodeStatus: entry.status,
  };
}

export function selectCandidatesToGeocode(
  authorization: GeocodeAuthorization,
  candidates: Array<ListingLead["candidate"]>,
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

export async function geocodeListingCandidates({
  authorization,
  candidates,
  signal,
  onResult,
}: GeocodeListingCandidateOptions) {
  const sessionId = getGeocodeSessionId();

  for (const candidate of candidates) {
    if (signal?.aborted) {
      return;
    }

    if (!candidate.geocodeQuery) {
      continue;
    }

    try {
      const response = await fetch("/api/geocode/listing", {
        method: "POST",
        signal,
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
        await onResult(candidate.id, {
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
      await onResult(candidate.id, { geocodeStatus: status ?? "failed" });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }

      await onResult(candidate.id, { geocodeStatus: "failed" });
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
