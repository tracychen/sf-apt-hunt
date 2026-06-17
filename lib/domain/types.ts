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
