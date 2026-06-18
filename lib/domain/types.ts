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

export type ListingLeadStatus = "new" | "seen";

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

export type MapPatchProposal = {
  summary: string;
  operations: Array<
    | { type: "addTarget"; target: TargetPoint }
    | { type: "addCorridor"; corridor: TargetCorridor }
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
  corridors: TargetCorridor[];
  targets: TargetPoint[];
};
