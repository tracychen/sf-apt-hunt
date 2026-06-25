export type Priority = "high" | "medium" | "low";

export type TargetInfluence = "positive" | "negative" | "neutral";

export type TargetRadiusMinutes = 5 | 10 | 15 | 20;

export type Score = 1 | 2 | 3 | 4 | 5;

export type Coordinate = [number, number];

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: Coordinate[][];
};

export type LineStringGeometry = {
  type: "LineString";
  coordinates: Coordinate[];
};

export type MapZone = {
  id: string;
  name: string;
  kind: "neighborhood" | "caution";
  geometry: PolygonGeometry;
  fitnessScore: Score;
  affordabilityScore: Score;
  carFreeScore: Score;
  notes: string[];
};

export type PlanningArea = {
  id: string;
  name: string;
  purpose: string;
  geometry: PolygonGeometry;
  priority: Priority;
  influence: TargetInfluence;
  notes: string[];
};

export type TargetCorridor = {
  id: string;
  name: string;
  geometry: LineStringGeometry;
  priority: Priority;
  tags: Array<"fitness" | "rent" | "transit" | "safety" | "short-term">;
  notes: string[];
};

export type TargetPoint = {
  id: string;
  name: string;
  purpose: string;
  coordinates: Coordinate;
  priority: Priority;
  influence: TargetInfluence;
  radiusMinutes: TargetRadiusMinutes;
  notes: string[];
};

export type SourceCitation = {
  url: string;
  title: string | null;
  sourceDomain: string;
};

export type ResearchConfidence = "high" | "medium" | "low";

export type CorridorGeometryQuality = "official" | "fromStops" | "approximate";

export type ResearchExclusionReason =
  | "duplicate"
  | "out_of_bounds"
  | "geocode_failed"
  | "missing_source"
  | "invalid_geometry"
  | "over_cap";

export type ResearchSummary = {
  items: ResearchSummaryItem[];
  exclusions: ResearchExclusion[];
  caveats: string[];
};

export type ResearchSummaryItem = {
  entityId: string;
  operationType: "addTarget" | "addCorridor";
  label: string;
  source: SourceCitation;
  confidence: ResearchConfidence;
  geometryQuality?: CorridorGeometryQuality;
  geocodePrecision?: "exact" | "approximate";
  caveats: string[];
};

export type ResearchExclusion = {
  label: string;
  reason: ResearchExclusionReason;
  source?: SourceCitation;
  caveats: string[];
};

export type ResearchedCorridorGeometrySourceFormat =
  | "gtfs"
  | "geojson"
  | "kml"
  | "polyline"
  | "unknown";

export type ResearchedCorridorSourceUrlGeometryCandidate = {
  kind: "sourceUrl";
  url: string;
  format: ResearchedCorridorGeometrySourceFormat;
};

export type ResearchedCorridorWaypointCandidate = {
  label: string;
  geocodeQuery: string;
};

export type ResearchedCorridorOrderedWaypointsGeometryCandidate = {
  kind: "orderedWaypoints";
  waypoints: ResearchedCorridorWaypointCandidate[];
};

export type ResearchedCorridorModelLineStringGeometryCandidate = {
  kind: "modelLineString";
  coordinates: Coordinate[];
  caveat: string;
};

export type ResearchedCorridorGeometryCandidate =
  | ResearchedCorridorSourceUrlGeometryCandidate
  | ResearchedCorridorOrderedWaypointsGeometryCandidate
  | ResearchedCorridorModelLineStringGeometryCandidate;

export type ResearchedTargetCandidate = {
  id: string;
  name: string;
  address: string | null;
  geocodeQuery: string;
  source: SourceCitation;
  purpose: string;
  influence: TargetInfluence;
  priority: Priority;
  radiusMinutes: TargetRadiusMinutes;
  confidence: ResearchConfidence;
  caveats: string[];
};

export type ResearchedCorridorCandidate = {
  id: string;
  name: string;
  source: SourceCitation;
  priority: Priority;
  tags: TargetCorridor["tags"];
  notes: string[];
  confidence: ResearchConfidence;
  requestedGeometryQuality: CorridorGeometryQuality;
  geometry: ResearchedCorridorGeometryCandidate;
  caveats: string[];
};

export type MapAssistantOutcome =
  | {
      kind: "needsMoreInfo";
      assistantMessage: string;
      missingInformation: string[];
    }
  | {
      kind: "proposal";
      assistantMessage: string;
      proposal: MapPatchProposal;
      researchSummary: ResearchSummary;
    }
  | {
      kind: "noAction";
      assistantMessage: string;
      caveats: string[];
    };

export type GeocodeAuthorization = {
  nonce: string;
  expiresAt: string;
  maxAttempts: number;
  allowedQueries: Array<{
    candidateId: string;
    geocodeQueryHash: string;
  }>;
};

export type ListingCandidate = {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  neighborhoodGuess: string;
  locationText: string | null;
  geocodeQuery: string | null;
  locationConfidence: "none" | "low" | "medium" | "high";
  coordinates: Coordinate | null;
  geocodeStatus:
    | "not_attempted"
    | "geocoded_exact"
    | "geocoded_approximate"
    | "failed"
    | "outside_sf";
  markerPrecision: "none" | "exact" | "approximate";
  priceMonthly: number | null;
  beds: "studio" | "1br" | "unknown";
  shortTermSignal: boolean;
  furnishedSignal: boolean;
  fitScore: Score;
  whyItFits: string;
  citations: SourceCitation[];
  caveats: string[];
};

export type ListingSearchFilters = {
  maxBudget: number | null;
  beds: "any" | "studio" | "1br";
  timing: string;
  shortTerm: boolean;
  furnished: boolean;
};

export type ListingLeadStatus = "new" | "seen" | "saved" | "dismissed";

export type ListingLead = {
  canonicalUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSearchQuery: string;
  seenCount: number;
  status: ListingLeadStatus;
  candidate: ListingCandidate;
};

export type ListingLedger = Record<string, ListingLead>;

export type GeocodeCacheEntry = {
  id: string;
  workspaceId: string;
  queryHash: string;
  query: string;
  result: {
    coordinates: Coordinate | null;
    geocodeQuery: string | null;
    geocodeStatus: ListingCandidate["geocodeStatus"];
    locationConfidence: ListingCandidate["locationConfidence"];
    markerPrecision: ListingCandidate["markerPrecision"];
    locationText: string | null;
    neighborhoodGuess: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ListingPlanningSignal = {
  label: string;
  delta: number;
};

export type ListingDisplayCandidate = ListingCandidate & {
  canonicalUrl: string;
  leadStatus: ListingLeadStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  planningScore: Score;
  planningSignals: string[];
};

export type ListingSearchResponse = {
  candidates: ListingCandidate[];
  sourceSummary: string;
  citations: SourceCitation[];
  caveats: string[];
  geocodeAuthorization: GeocodeAuthorization | null;
};

export type ListingsResponse = {
  leads: ListingLead[];
  listingLedgerRevision: string;
};

export type PatchListingRequest = {
  expectedListingLedgerRevision: string;
  status: "saved" | "dismissed";
};

export type PatchListingResponse =
  | { ok: true; lead: ListingLead; listingLedgerRevision: string }
  | {
      ok: false;
      error: "stale_listing_ledger_revision";
      currentListingLedgerRevision: string;
    }
  | { ok: false; error: "listing_not_found" };

export type PostGeocodeCacheRequest = {
  expectedListingLedgerRevision: string;
  canonicalUrl: string;
  queryHash: string;
  query: string;
  result: {
    coordinates: Coordinate | null;
    geocodeQuery: string | null;
    geocodeStatus: ListingCandidate["geocodeStatus"];
    locationConfidence: ListingCandidate["locationConfidence"];
    markerPrecision: ListingCandidate["markerPrecision"];
    locationText: string | null;
    neighborhoodGuess: string;
  };
};

export type PostGeocodeCacheResponse =
  | {
      ok: true;
      lead: ListingLead;
      cacheEntry: GeocodeCacheEntry;
      listingLedgerRevision: string;
    }
  | {
      ok: false;
      error: "stale_listing_ledger_revision";
      currentListingLedgerRevision: string;
    }
  | { ok: false; error: "listing_not_found" };

export type SelectedMapEntity =
  | { kind: "zone"; id: string }
  | { kind: "area"; id: string }
  | { kind: "corridor"; id: string }
  | { kind: "target"; id: string }
  | null;

export type PlanningMessageRole = "user" | "assistant";

export type PlanningActionStatus = "pending" | "applied" | "dismissed" | "failed";

export type PlanningActionFailureKind = "retryable" | "permanent";

export type PlanningContextSummary = {
  budget: number | null;
  beds: ListingSearchFilters["beds"] | null;
  timing: string | null;
  furnished: boolean | null;
  shortTerm: boolean | null;
  positiveAnchors: string[];
  avoidAnchors: string[];
  selectedZones: string[];
  sourceStrictness: string | null;
};

export type MapSnapshot = {
  id: string;
  threadId: string;
  clientInstallationId: string;
  mapState: MapState;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRecord = {
  id: string;
  userId: string;
  name: string;
  listingLedgerRevision: string;
  onboardingProgress: OnboardingProgress;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingStepId =
  | "set_ai_key"
  | "ask_for_anchors"
  | "apply_map_suggestion"
  | "edit_anchor_meaning"
  | "ask_for_listings"
  | "review_listing";

export type OnboardingProgress = {
  version: 1;
  dismissed: boolean;
  expanded: boolean;
  completedSteps: Partial<Record<OnboardingStepId, string>>;
  lastHighlightedStepId: OnboardingStepId | null;
  updatedAt: string;
};

export type OnboardingOperation =
  | { type: "completeSteps"; stepIds: OnboardingStepId[] }
  | {
      type: "setPanelState";
      dismissed?: boolean;
      expanded?: boolean;
      lastHighlightedStepId?: OnboardingStepId | null;
    }
  | { type: "reset" };

export type PutWorkspaceOnboardingRequest = {
  operation: OnboardingOperation;
};

export type PutWorkspaceOnboardingResponse =
  | { ok: true; progress: OnboardingProgress }
  | {
      ok: false;
      error:
        | "forbidden_origin"
        | "unauthorized"
        | "request_too_large"
        | "invalid_request"
        | "onboarding_update_failed";
    };

export type WorkspaceMapSnapshot = {
  id: string;
  workspaceId: string;
  revision: string;
  mapState: MapState;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceResponse = {
  workspace: WorkspaceRecord;
  mapSnapshot: WorkspaceMapSnapshot;
  listingLedgerRevision: string;
};

export type PutWorkspaceMapRequest = {
  expectedMapRevision: string;
  mapState: MapState;
};

export type PutWorkspaceMapResponse =
  | { ok: true; mapSnapshot: WorkspaceMapSnapshot; invalidatedActionIds: string[] }
  | { ok: false; error: "stale_map_revision"; currentMapRevision: string };

export type ImportWorkspaceMapRequest = PutWorkspaceMapRequest;
export type ImportWorkspaceMapResponse = PutWorkspaceMapResponse;

export type WorkspaceResetRequest = {
  expectedMapRevision: string;
  expectedListingLedgerRevision: string;
  confirmation: "reset";
};

export type WorkspaceResetResponse =
  | {
      ok: true;
      workspace: WorkspaceRecord;
      mapSnapshot: WorkspaceMapSnapshot;
      listingLedgerRevision: string;
    }
  | {
      ok: false;
      error: "stale_workspace_revision";
      currentMapRevision: string;
      currentListingLedgerRevision: string;
    };

export type PlanningListingCard = {
  lead: ListingLead;
  display: ListingDisplayCandidate;
  saveActionId: string;
  dismissActionId: string;
};

export type PlanningChatPart =
  | { type: "text"; text: string }
  | { type: "contextSummary"; context: PlanningContextSummary }
  | { type: "followUpQuestion"; question: string; missingInformation: string[] }
  | {
      type: "mapProposal";
      actionId: string;
      proposal: MapPatchProposal;
      researchSummary: ResearchSummary | null;
    }
  | {
      type: "listingResults";
      resultSetId: string;
      listings: PlanningListingCard[];
      sourceSummary: string;
      caveats: string[];
      geocodeAuthorization: GeocodeAuthorization | null;
    }
  | { type: "targetEditProposal"; actionId: string; proposal: MapPatchProposal }
  | { type: "error"; message: string };

export type PlanningMessage = {
  id: string;
  threadId: string;
  role: PlanningMessageRole;
  parts: PlanningChatPart[];
  createdAt: string;
};

export type PlanningThread = {
  id: string;
  clientInstallationId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  summary: string;
};

export type PlanningActionTarget =
  | {
      kind: "mapProposal";
      messageId: string;
      partIndex: number;
      proposalHash: string;
      allowedOperationIndexes: number[];
      mapRevision: string;
    }
  | {
      kind: "mapProposalItem";
      messageId: string;
      partIndex: number;
      proposalHash: string;
      operationIndex: number;
      mapRevision: string;
    }
  | {
      kind: "listingLead";
      resultSetId: string;
      canonicalUrl: string;
      listingSnapshotHash: string;
      listingLedgerRevision: string;
    }
  | {
      kind: "targetEdit";
      messageId: string;
      partIndex: number;
      proposalHash: string;
      allowedOperationIndexes: number[];
      mapRevision: string;
    };

export type PlanningActionRecord = {
  id: string;
  threadId: string;
  messageId: string;
  partIndex: number;
  kind: "mapProposal" | "mapProposalItem" | "listingSave" | "listingDismiss" | "targetEdit";
  target: PlanningActionTarget;
  status: PlanningActionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  failureKind?: PlanningActionFailureKind;
};

export type PlanningActionExecutionRecord = {
  id: string;
  actionId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: "in_progress" | "succeeded" | "failed";
  createdAt: string;
  error?: string;
};

export type PlanningChatRequest = {
  threadId: string | null;
  clientInstallationId: string;
  message: string;
  mapState: MapState;
  mapRevision: string | null;
  listingLedgerRevision: string | null;
  selectedEntity: SelectedMapEntity;
  visibleContext: PlanningContextSummary | null;
};

export type PlanningChatResponse = {
  thread: PlanningThread;
  userMessage: PlanningMessage;
  assistantMessage: PlanningMessage;
  contextSummary: PlanningContextSummary;
  actionRecords: PlanningActionRecord[];
  mapSnapshot: MapSnapshot;
  listingLedgerRevision: string;
};

export type ExecutePlanningActionRequest = {
  threadId: string;
  actionId: string;
  idempotencyKey: string;
  payload:
    | { kind: "mapProposal"; operationIndexes: number[]; expectedMapRevision: string }
    | {
        kind: "listingSave";
        expectedListingLedgerRevision: string;
        expectedListingSnapshotHash: string;
      }
    | {
        kind: "listingDismiss";
        expectedListingLedgerRevision: string;
        expectedListingSnapshotHash: string;
      }
    | { kind: "targetEdit"; operationIndexes: number[]; expectedMapRevision: string }
    | { kind: "dismiss" };
};

export type ExecutePlanningActionResponse = {
  action: PlanningActionRecord;
  execution: PlanningActionExecutionRecord;
  mapSnapshot?: MapSnapshot;
  mapState?: MapState;
  listingLead?: ListingLead;
  listingLedgerRevision?: string;
  messagePatch?: PlanningMessage;
};

export type PlanningResetRequest = {
  clientInstallationId: string;
};

export type MapPatchProposal = {
  summary: string;
  operations: Array<
    | { type: "addTarget"; target: TargetPoint }
    | { type: "addCorridor"; corridor: TargetCorridor }
    | { type: "addArea"; area: PlanningArea }
    | {
        type: "updateCorridorPriority";
        corridorId: string;
        priority: Priority;
        reason: string;
      }
    | {
        type: "updateTargetPriority";
        targetId: string;
        priority: Priority;
        reason: string;
      }
    | {
        type: "updateTargetPlanningFields";
        targetId: string;
        name?: string;
        purpose?: string;
        influence?: TargetInfluence;
        priority?: Priority;
        radiusMinutes?: TargetRadiusMinutes;
        notes?: string[];
        reason: string;
      }
    | {
        type: "updateAreaPlanningFields";
        areaId: string;
        name?: string;
        purpose?: string;
        influence?: TargetInfluence;
        priority?: Priority;
        notes?: string[];
        reason: string;
      }
    | {
        type: "updateZoneScores";
        zoneId: string;
        fitnessScore?: Score;
        affordabilityScore?: Score;
        carFreeScore?: Score;
      }
    | {
        type: "replaceZoneGeometry";
        zoneId: string;
        geometry: PolygonGeometry;
        reason: string;
      }
    | { type: "addNote"; entityId: string; note: string }
  >;
  confidence: "low" | "medium" | "high";
  requiresUserReview: true;
};

export type MapState = {
  zones: MapZone[];
  areas?: PlanningArea[];
  corridors: TargetCorridor[];
  targets: TargetPoint[];
};
