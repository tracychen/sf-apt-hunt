"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  ApartmentMapViewport,
  applyCachedGeocodeEntries,
  defaultVisibleLayers,
  geocodeListingCandidates,
  isEditableKeyboardTarget,
  isUndoKeyboardShortcut,
  mapHistoryReducer,
  planningFiltersFromContextSummary,
  resetMapEntity,
  scoreAndSortListingLeads,
  selectCandidatesToGeocode,
  upsertListingLead,
  type MapHistoryState,
} from "@/components/apartment-map/apartment-map-app";
import { Sidebar } from "@/components/apartment-map/sidebar";
import { useOnboardingController } from "@/components/apartment-map/use-onboarding-controller";
import { useOnboardingHighlights } from "@/components/apartment-map/use-onboarding-highlights";
import {
  postGeocodeCacheResponseSchema,
  putWorkspaceMapResponseSchema,
  workspaceResetResponseSchema,
} from "@/lib/domain/schemas";
import type {
  GeocodeAuthorization,
  ListingLead,
  ListingSearchFilters,
  MapState,
  PlanningContextSummary,
} from "@/lib/domain/types";
import { createDefaultOnboardingProgress } from "@/lib/onboarding/progress";
import { loadStoredOpenAiKey } from "@/lib/storage/api-key-storage";
import {
  canonicalizeGeocodeCacheQuery,
  saveGeocodeCacheEntry,
} from "@/lib/storage/map-storage";

import {
  persistentWorkspaceInitialStateSchema,
  type PersistentWorkspaceInitialState,
} from "@/components/apartment-map/persistence-types";
import type {
  SelectedMapEntity,
  VisibleMapLayers,
} from "@/components/apartment-map/leaflet-map";
import type { PlanningChatOnboardingMilestone } from "@/components/apartment-map/planning-chat-panel";

const loadingState: MapHistoryState = {
  current: {
    zones: [],
    areas: [],
    corridors: [],
    targets: [],
  },
  history: [],
};

type SidebarNotice =
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | null;

export function PersistentApartmentMapApp({
  initialState,
}: {
  initialState?: PersistentWorkspaceInitialState | null;
}) {
  const [workspaceState, setWorkspaceState] = useState<PersistentWorkspaceInitialState | null>(
    initialState ?? null,
  );
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(initialState === null);
  const [sidebarNotice, setSidebarNotice] = useState<SidebarNotice>(null);
  const [mapHistory, dispatchMapHistory] = useReducer(
    mapHistoryReducer,
    initialState
      ? {
          current: initialState.mapSnapshot.mapState,
          history: [],
        }
      : loadingState,
  );
  const [mapRevision, setMapRevision] = useState(initialState?.mapSnapshot.revision ?? "");
  const [listingLedgerRevision, setListingLedgerRevision] = useState(
    initialState?.listingLedgerRevision ?? "",
  );
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<SelectedMapEntity>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [visibleLayers, setVisibleLayers] = useState<VisibleMapLayers>(defaultVisibleLayers);
  const [listingLeads, setListingLeads] = useState<ListingLead[]>(
    initialState?.listingLeads ?? [],
  );
  const [activeListingFilters, setActiveListingFilters] = useState<ListingSearchFilters | null>(
    null,
  );
  const [planningResetToken, setPlanningResetToken] = useState(0);
  const [invalidatedActionIds, setInvalidatedActionIds] = useState<string[]>([]);
  const [fallbackOnboardingProgress] = useState(() =>
    createDefaultOnboardingProgress(new Date().toISOString()),
  );
  const geocodeRunIdRef = useRef(0);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const mapRevisionRef = useRef(mapRevision);
  const listingLedgerRevisionRef = useRef(listingLedgerRevision);
  const pendingMapStateRef = useRef<MapState | null>(null);
  const mapWriteLoopRef = useRef<Promise<void> | null>(null);
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
  const onboarding = useOnboardingController({
    apiKey,
    listingLeads,
    mode: {
      kind: "workspace",
      initialProgress:
        workspaceState?.workspace.onboardingProgress ??
        initialState?.workspace.onboardingProgress ??
        fallbackOnboardingProgress,
    },
    planningThreadCache:
      workspaceState?.planningThreadCache ?? initialState?.planningThreadCache ?? null,
  });
  const onboardingHighlights = useOnboardingHighlights();

  useEffect(() => {
    mapRevisionRef.current = mapRevision;
  }, [mapRevision]);

  useEffect(() => {
    listingLedgerRevisionRef.current = listingLedgerRevision;
  }, [listingLedgerRevision]);

  useEffect(() => {
    const keyLoadTimeout = window.setTimeout(() => {
      const storedOpenAiKey = loadStoredOpenAiKey();
      setApiKey(storedOpenAiKey.key);
      setRemembered(storedOpenAiKey.remembered);
    }, 0);

    return () => window.clearTimeout(keyLoadTimeout);
  }, []);

  const applyWorkspaceState = useCallback((nextState: PersistentWorkspaceInitialState) => {
    setWorkspaceState(nextState);
    dispatchMapHistory({ type: "hydrate", state: nextState.mapSnapshot.mapState });
    setMapRevision(nextState.mapSnapshot.revision);
    setListingLedgerRevision(nextState.listingLedgerRevision);
    setListingLeads(nextState.listingLeads);
    setSelectedEntity(null);
    setSelectedZoneIds([]);
  }, []);

  const loadWorkspaceState = useCallback(async (notice?: SidebarNotice) => {
    setIsLoadingWorkspace(true);

    try {
      const response = await fetch("/api/workspace/client-state", {
        method: "GET",
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = persistentWorkspaceInitialStateSchema.parse(body);

      applyWorkspaceState(parsed);
      setSidebarNotice(notice ?? null);
      setInvalidatedActionIds([]);
    } catch (error) {
      setSidebarNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Workspace client state failed.",
      });
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [applyWorkspaceState]);

  useEffect(() => {
    if (initialState !== null && process.env.NODE_ENV === "production") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void loadWorkspaceState();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialState, loadWorkspaceState]);

  const flushQueuedMapWrites = useCallback(async () => {
    try {
      while (pendingMapStateRef.current) {
        const stateToWrite = pendingMapStateRef.current;
        pendingMapStateRef.current = null;

        const response = await fetch("/api/workspace/map", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedMapRevision: mapRevisionRef.current,
            mapState: stateToWrite,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        const parsed = putWorkspaceMapResponseSchema.parse(body);

        if (!parsed.ok) {
          await loadWorkspaceState({
            kind: "error",
            message:
              "This map edit conflicted with a newer workspace revision. Reloaded the latest workspace state.",
          });
          return;
        }

        setMapRevision(parsed.mapSnapshot.revision);
        setInvalidatedActionIds(parsed.invalidatedActionIds);
        setSidebarNotice(null);
      }
    } finally {
      mapWriteLoopRef.current = null;

      if (pendingMapStateRef.current) {
        mapWriteLoopRef.current = flushQueuedMapWrites();
      }
    }
  }, [loadWorkspaceState]);

  async function waitForMapWrites() {
    if (mapWriteLoopRef.current) {
      await mapWriteLoopRef.current;
    }
  }

  const queueMapWrite = useCallback((nextState: MapState) => {
    pendingMapStateRef.current = nextState;
    if (!mapWriteLoopRef.current) {
      mapWriteLoopRef.current = flushQueuedMapWrites();
    }
  }, [flushQueuedMapWrites]);

  function updateMapState(nextState: MapState) {
    dispatchMapHistory({ type: "update", state: nextState });
    queueMapWrite(nextState);
  }

  function applyPlanningMapState(input: { mapState: MapState; mapRevision?: string | null }) {
    dispatchMapHistory({ type: "update", state: input.mapState });
    if (input.mapRevision) {
      setMapRevision(input.mapRevision);
    }
    onboarding.completeSteps(["apply_map_suggestion"]);
  }

  const undoLastEdit = useCallback(() => {
    const previous = mapHistory.history.at(-1);
    if (!previous) {
      return;
    }

    dispatchMapHistory({ type: "undo" });
    queueMapWrite(previous);
  }, [mapHistory.history, queueMapWrite]);

  useEffect(() => {
    function handleKeyboardUndo(event: KeyboardEvent) {
      if (event.key === "Escape" && selectedEntity && !isEditableKeyboardTarget(event.target)) {
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
  }, [canUndo, mapHistory.history, selectedEntity, undoLastEdit]);

  async function resetWorkspaceMap() {
    await waitForMapWrites();

    const response = await fetch("/api/workspace/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedMapRevision: mapRevisionRef.current,
        expectedListingLedgerRevision: listingLedgerRevisionRef.current,
        confirmation: "reset",
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = workspaceResetResponseSchema.parse(body);

    if (!parsed.ok) {
      await loadWorkspaceState({
        kind: "error",
        message:
          "This reset conflicted with a newer workspace revision. Reloaded the latest workspace state.",
      });
      return false;
    }

    dispatchMapHistory({ type: "hydrate", state: parsed.mapSnapshot.mapState });
    setWorkspaceState((current) =>
      current
        ? {
            ...current,
            workspace: parsed.workspace,
            mapSnapshot: parsed.mapSnapshot,
            listingLeads: [],
            listingLedgerRevision: parsed.listingLedgerRevision,
            planningThreadCache: null,
          }
        : null,
    );
    setMapRevision(parsed.mapSnapshot.revision);
    setListingLedgerRevision(parsed.listingLedgerRevision);
    setListingLeads([]);
    geocodeRunIdRef.current += 1;
    geocodeAbortRef.current?.abort();
    setSelectedEntity(null);
    setSelectedZoneIds([]);
    setActiveListingFilters(null);
    setPlanningResetToken((current) => current + 1);
    setInvalidatedActionIds([]);
    setSidebarNotice(null);
    return true;
  }

  async function importMapState(nextState: MapState) {
    await waitForMapWrites();

    const response = await fetch("/api/workspace/map/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedMapRevision: mapRevisionRef.current,
        mapState: nextState,
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = putWorkspaceMapResponseSchema.parse(body);

    if (!parsed.ok) {
      await loadWorkspaceState({
        kind: "error",
        message:
          "This import conflicted with a newer workspace revision. Reloaded the latest workspace state.",
      });
      return false;
    }

    dispatchMapHistory({ type: "hydrate", state: parsed.mapSnapshot.mapState });
    setWorkspaceState((current) =>
      current
        ? {
            ...current,
            mapSnapshot: parsed.mapSnapshot,
          }
        : current,
    );
    setMapRevision(parsed.mapSnapshot.revision);
    setSelectedEntity(null);
    setSelectedZoneIds([]);
    setActiveListingFilters(null);
    setInvalidatedActionIds(parsed.invalidatedActionIds);
    setSidebarNotice(null);
    return true;
  }

  function resetSelectedShape() {
    if (!selectedEntity) {
      return;
    }

    const nextState = resetMapEntity(mapState, selectedEntity);
    updateMapState(nextState);

    if (selectedEntity.kind === "zone" && !nextState.zones.some((zone) => zone.id === selectedEntity.id)) {
      setSelectedZoneIds((ids) => ids.filter((id) => id !== selectedEntity.id));
      setSelectedEntity(null);
    }

    if (
      selectedEntity.kind === "corridor" &&
      !nextState.corridors.some((corridor) => corridor.id === selectedEntity.id)
    ) {
      setSelectedEntity(null);
    }

    if (
      selectedEntity.kind === "area" &&
      !(nextState.areas ?? []).some((area) => area.id === selectedEntity.id)
    ) {
      setSelectedEntity(null);
    }

    if (
      selectedEntity.kind === "target" &&
      !nextState.targets.some((target) => target.id === selectedEntity.id)
    ) {
      setSelectedEntity(null);
    }
  }

  function updateApiKey(nextApiKey: string | null, nextRemembered: boolean) {
    setApiKey(nextApiKey);
    setRemembered(nextRemembered);
    if (nextApiKey) {
      onboarding.completeSteps(["set_ai_key"]);
    }
  }

  function handlePlanningChatOnboardingMilestone(
    milestone: PlanningChatOnboardingMilestone,
  ) {
    if (milestone.kind === "anchorProposalReceived") {
      onboarding.completeSteps(["ask_for_anchors"]);
      return;
    }

    onboarding.completeSteps(["ask_for_listings"]);
  }

  function handleAnchorSemanticEdit() {
    onboarding.completeSteps(["edit_anchor_meaning"]);
  }

  async function persistGeocodeResult(lead: ListingLead) {
    const geocodeQuery = lead.candidate.geocodeQuery;

    if (!geocodeQuery) {
      return;
    }

    const response = await fetch("/api/workspace/geocode-cache", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedListingLedgerRevision: listingLedgerRevisionRef.current,
        canonicalUrl: lead.canonicalUrl,
        queryHash: canonicalizeGeocodeCacheQuery(geocodeQuery),
        query: geocodeQuery,
        result: {
          coordinates: lead.candidate.coordinates,
          geocodeQuery: lead.candidate.geocodeQuery,
          geocodeStatus: lead.candidate.geocodeStatus,
          locationConfidence: lead.candidate.locationConfidence,
          markerPrecision: lead.candidate.markerPrecision,
          locationText: lead.candidate.locationText,
          neighborhoodGuess: lead.candidate.neighborhoodGuess,
        },
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = postGeocodeCacheResponseSchema.parse(body);

    if (parsed.ok) {
      setListingLedgerRevision(parsed.listingLedgerRevision);
      setListingLeads((current) => upsertListingLead(current, parsed.lead));
      return;
    }

    await loadWorkspaceState({
      kind: "error",
      message:
        "A geocode update conflicted with a newer workspace revision. Reloaded the latest workspace state.",
    });
  }

  function updateListingLeadLocally(lead: ListingLead, candidateId: string, update: Partial<ListingLead["candidate"]>) {
    let updatedLead: ListingLead | null = null;

    setListingLeads((currentLeads) =>
      currentLeads.map((currentLead) => {
        if (currentLead.candidate.id !== candidateId) {
          return currentLead;
        }

        updatedLead = {
          ...currentLead,
          candidate: {
            ...currentLead.candidate,
            ...update,
          },
        };
        return updatedLead;
      }),
    );

    return updatedLead ?? lead;
  }

  function handlePlanningListingLeadChange({
    lead,
    contextSummary,
    geocodeAuthorization,
    listingLedgerRevision: nextListingLedgerRevision,
  }: {
    lead: ListingLead;
    contextSummary: PlanningContextSummary | null;
    geocodeAuthorization: GeocodeAuthorization | null;
    listingLedgerRevision?: string | null;
  }) {
    if (nextListingLedgerRevision) {
      setListingLedgerRevision(nextListingLedgerRevision);
    }

    if (lead.status === "dismissed") {
      onboarding.completeSteps(["review_listing"]);
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

    if (lead.status !== "saved") {
      return;
    }

    onboarding.completeSteps(["review_listing"]);

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
      onResult: async (candidateId, update) => {
        if (geocodeRunIdRef.current !== nextRunId) {
          return;
        }

        const updatedLead = updateListingLeadLocally(nextLead, candidateId, update);
        const geocodeQuery = updatedLead.candidate.geocodeQuery;

        if (geocodeQuery) {
          const cacheEntry:
            | { coordinates: [number, number]; markerPrecision: "exact" | "approximate" }
            | { status: "failed" | "outside_sf" } =
            updatedLead.candidate.coordinates &&
            (updatedLead.candidate.markerPrecision === "exact" ||
              updatedLead.candidate.markerPrecision === "approximate")
              ? {
                  coordinates: updatedLead.candidate.coordinates,
                  markerPrecision: updatedLead.candidate.markerPrecision,
                }
              : {
                  status:
                    updatedLead.candidate.geocodeStatus === "outside_sf"
                      ? "outside_sf"
                      : "failed",
                };
          saveGeocodeCacheEntry(geocodeQuery, cacheEntry);
        }

        await persistGeocodeResult(updatedLead);
      },
    });
  }

  if (!workspaceState) {
    return (
      <main
        className={
          sidebarNotice?.kind === "error"
            ? "flex min-h-screen items-center justify-center bg-background px-6 text-center text-sm text-destructive"
            : "flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
        }
      >
        {isLoadingWorkspace ? "Loading workspace..." : sidebarNotice?.message ?? "Workspace unavailable."}
      </main>
    );
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
        ownershipMode="workspace"
        apiKey={apiKey}
        remembered={remembered}
        mapState={mapState}
        selectedEntity={selectedEntity}
        visibleLayers={visibleLayers}
        selectedZoneIds={selectedZoneIds}
        listings={listings}
        onboarding={onboarding}
        planningResetToken={planningResetToken}
        planningOwnershipMode={{
          kind: "workspace",
          mapRevision,
          listingLedgerRevision,
          invalidatedActionIds,
          threadCache: workspaceState.planningThreadCache,
        }}
        sidebarNotice={sidebarNotice}
        onboardingHighlightMessage={onboardingHighlights.message}
        onApiKeyChange={updateApiKey}
        onDeselectSelectedEntity={() => setSelectedEntity(null)}
        onImportMapState={importMapState}
        onMapStateChange={updateMapState}
        onAnchorSemanticEdit={handleAnchorSemanticEdit}
        onPlanningChatOnboardingMilestone={handlePlanningChatOnboardingMilestone}
        onPlanningMapStateChange={applyPlanningMapState}
        onPlanningListingLeadChange={handlePlanningListingLeadChange}
        onShowOnboardingStep={(stepId) => {
          onboarding.setPanelState({ lastHighlightedStepId: stepId });
          onboardingHighlights.showOnboardingStep(stepId);
        }}
        onVisibleLayersChange={setVisibleLayers}
        onUndo={undoLastEdit}
        onReset={resetWorkspaceMap}
        onResetSelectedShapes={resetSelectedShape}
        canUndo={canUndo}
        canResetSelectedShapes={selectedEntity !== null}
      />
    </main>
  );
}
