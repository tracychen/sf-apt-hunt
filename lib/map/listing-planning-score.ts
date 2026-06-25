import type {
  Coordinate,
  LineStringGeometry,
  ListingDisplayCandidate,
  ListingLead,
  ListingPlanningSignal,
  ListingSearchFilters,
  MapState,
  Priority,
  Score,
} from "@/lib/domain/types";
import { getPlanningAreas, isPointInPolygon } from "@/lib/map/planning-areas";
import { targetRadiusMeters } from "@/lib/map/target-points";

const EARTH_RADIUS_METERS = 6_371_000;
const CORRIDOR_RADIUS_METERS = 400;
const METERS_PER_DEGREE_LATITUDE = 111_320;

const priorityWeights: Record<Priority, number> = {
  high: 1,
  medium: 0.6,
  low: 0.3,
};

const signalKindOrder = [
  "budget",
  "beds",
  "negative-area",
  "negative-target",
  "positive-target",
  "positive-area",
  "corridor",
  "location",
] as const;

type SignalKind = (typeof signalKindOrder)[number];

type WeightedSignal = ListingPlanningSignal & {
  kind: SignalKind;
};

type ScoreListingLeadOptions = {
  lead: ListingLead;
  filters: ListingSearchFilters;
  mapState: MapState;
  selectedZoneIds: string[];
};

export function scoreListingLead({
  lead,
  filters,
  mapState,
}: ScoreListingLeadOptions): ListingDisplayCandidate {
  const candidate = lead.candidate;
  const signals = [
    readBudgetSignal(candidate.priceMonthly, filters.maxBudget),
    readBedSignal(candidate.beds, filters.beds),
    readAreaSignal(candidate, mapState, "negative-area"),
    readTargetSignal(candidate.coordinates, mapState, "negative-target"),
    readTargetSignal(candidate.coordinates, mapState, "positive-target"),
    readAreaSignal(candidate, mapState, "positive-area"),
    readCorridorSignal(candidate.coordinates, mapState),
    readLocationSignal(candidate.coordinates, candidate.markerPrecision),
  ].filter((signal): signal is WeightedSignal => signal !== null);

  const planningScore = clampScore(
    Math.round(3 + signals.reduce((total, signal) => total + signal.delta, 0)),
  );

  return {
    ...candidate,
    canonicalUrl: lead.canonicalUrl,
    leadStatus: lead.status,
    firstSeenAt: lead.firstSeenAt,
    lastSeenAt: lead.lastSeenAt,
    seenCount: lead.seenCount,
    planningScore,
    planningSignals: signals.sort(compareSignals).slice(0, 3).map((signal) => signal.label),
  };
}

export function compareListingDisplayCandidates(
  left: ListingDisplayCandidate,
  right: ListingDisplayCandidate,
) {
  const scoreDelta = right.planningScore - left.planningScore;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  if (left.leadStatus !== right.leadStatus) {
    return left.leadStatus === "new" ? -1 : 1;
  }

  const seenDelta = Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
  if (seenDelta !== 0) {
    return seenDelta;
  }

  return left.title.localeCompare(right.title);
}

export function haversineDistanceMeters(left: Coordinate, right: Coordinate) {
  const leftLatitude = toRadians(left[1]);
  const rightLatitude = toRadians(right[1]);
  const latitudeDelta = toRadians(right[1] - left[1]);
  const longitudeDelta = toRadians(right[0] - left[0]);

  const centralAngle =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(centralAngle), Math.sqrt(1 - centralAngle))
  );
}

export function pointToLineStringDistanceMeters(point: Coordinate, line: LineStringGeometry) {
  if (line.coordinates.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(
    ...line.coordinates.slice(0, -1).map((start, index) => {
      const end = line.coordinates[index + 1];
      return end ? pointToSegmentDistanceMeters(point, start, end) : Number.POSITIVE_INFINITY;
    }),
  );
}

function readBudgetSignal(
  priceMonthly: number | null,
  maxBudget: number | null,
): WeightedSignal | null {
  if (priceMonthly === null) {
    return { kind: "budget", label: "Price needs verification", delta: 0 };
  }

  if (maxBudget === null) {
    return null;
  }

  if (priceMonthly <= maxBudget) {
    return { kind: "budget", label: "Within budget", delta: 0.7 };
  }

  return { kind: "budget", label: "Over budget", delta: -1 };
}

function readBedSignal(
  candidateBeds: "studio" | "1br" | "unknown",
  requestedBeds: "any" | "studio" | "1br",
): WeightedSignal | null {
  if (requestedBeds === "any") {
    return null;
  }

  if (candidateBeds === requestedBeds) {
    return { kind: "beds", label: "Matches bed filter", delta: 0.4 };
  }

  if (candidateBeds === "unknown") {
    return { kind: "beds", label: "Bed count unclear", delta: -0.2 };
  }

  return { kind: "beds", label: "Bed count mismatch", delta: -0.5 };
}

function readTargetSignal(
  coordinates: Coordinate | null,
  mapState: MapState,
  kind: "negative-target" | "positive-target",
): WeightedSignal | null {
  if (!coordinates) {
    return null;
  }

  const influence = kind === "positive-target" ? "positive" : "negative";
  const matches = mapState.targets
    .filter((target) => target.influence === influence)
    .map((target): WeightedSignal | null => {
      const radius = targetRadiusMeters(target);
      const distance = haversineDistanceMeters(coordinates, target.coordinates);

      if (distance > radius) {
        return null;
      }

      const targetWeight = distance <= radius / 2 ? 0.8 : 0.4;
      const magnitude = targetWeight * priorityWeights[target.priority];

      return {
        kind,
        label:
          influence === "positive"
            ? `Near ${target.purpose}`
            : `Near avoided ${target.purpose}`,
        delta: influence === "positive" ? magnitude : -magnitude,
      };
    })
    .filter((signal): signal is WeightedSignal => signal !== null);

  return strongestSignal(matches);
}

function readCorridorSignal(
  coordinates: Coordinate | null,
  mapState: MapState,
): WeightedSignal | null {
  if (!coordinates) {
    return null;
  }

  const matches = mapState.corridors
    .map((corridor) => {
      const distance = pointToLineStringDistanceMeters(coordinates, corridor.geometry);

      if (distance > CORRIDOR_RADIUS_METERS) {
        return null;
      }

      return {
        kind: "corridor",
        label: `Near ${corridor.name}`,
        delta: 0.3 * priorityWeights[corridor.priority],
      };
    })
    .filter((signal): signal is WeightedSignal => signal !== null);

  return strongestSignal(matches);
}

function readAreaSignal(
  candidate: ListingLead["candidate"],
  mapState: MapState,
  kind: "negative-area" | "positive-area",
): WeightedSignal | null {
  const influence = kind === "positive-area" ? "positive" : "negative";
  const candidateNeighborhoodText = normalizeText(candidate.neighborhoodGuess);
  const candidateLocationText = normalizeText(
    `${candidate.neighborhoodGuess} ${candidate.locationText ?? ""}`,
  );
  const matches = getPlanningAreas(mapState)
    .filter((area) => area.influence === influence)
    .map((area): WeightedSignal | null => {
      const pointMatch = candidate.coordinates
        ? isPointInPolygon(candidate.coordinates, area.geometry)
        : false;
      const normalizedAreaName = normalizeText(area.name);
      const normalizedAreaPurpose = normalizeText(area.purpose);
      const nameMatch = textIncludesMeaningfulMatch(candidateLocationText, normalizedAreaName);
      const reverseNameMatch =
        textIncludesMeaningfulMatch(normalizedAreaName, candidateNeighborhoodText) ||
        textIncludesMeaningfulMatch(normalizedAreaName, candidateLocationText);
      const purposeMatch =
        textIncludesMeaningfulMatch(candidateLocationText, normalizedAreaPurpose) ||
        textIncludesMeaningfulMatch(normalizedAreaPurpose, candidateNeighborhoodText) ||
        textIncludesMeaningfulMatch(normalizedAreaPurpose, candidateLocationText);
      const textMatch =
        !candidate.coordinates && (nameMatch || reverseNameMatch || purposeMatch);

      if (!pointMatch && !textMatch) {
        return null;
      }

      const direction = influence === "positive" ? 1 : -1;
      const label =
        influence === "positive"
          ? pointMatch
            ? "Inside preferred area"
            : "Matches preferred area"
          : pointMatch
            ? "Inside avoided area"
            : "Matches avoided area";
      const baseDelta = pointMatch ? 0.5 : 0.3;

      return {
        kind,
        label,
        delta: direction * baseDelta * priorityWeights[area.priority],
      };
    })
    .filter((signal): signal is WeightedSignal => signal !== null);

  return strongestSignal(matches);
}

function readLocationSignal(
  coordinates: Coordinate | null,
  markerPrecision: ListingLead["candidate"]["markerPrecision"],
): WeightedSignal | null {
  if (!coordinates) {
    return { kind: "location", label: "Location not pinned yet", delta: -0.4 };
  }

  if (markerPrecision === "exact") {
    return { kind: "location", label: "Exact pin", delta: 0.2 };
  }

  return null;
}

function textIncludesMeaningfulMatch(container: string, query: string) {
  return container.length > 0 && query.length > 0 && container.includes(query);
}

function pointToSegmentDistanceMeters(point: Coordinate, start: Coordinate, end: Coordinate) {
  const projectedPoint = projectToMeters(point, point);
  const projectedStart = projectToMeters(start, point);
  const projectedEnd = projectToMeters(end, point);
  const segmentX = projectedEnd.x - projectedStart.x;
  const segmentY = projectedEnd.y - projectedStart.y;
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;

  if (segmentLengthSquared === 0) {
    return Math.hypot(projectedPoint.x - projectedStart.x, projectedPoint.y - projectedStart.y);
  }

  const segmentPosition = Math.max(
    0,
    Math.min(
      1,
      ((projectedPoint.x - projectedStart.x) * segmentX +
        (projectedPoint.y - projectedStart.y) * segmentY) /
        segmentLengthSquared,
    ),
  );
  const closestX = projectedStart.x + segmentPosition * segmentX;
  const closestY = projectedStart.y + segmentPosition * segmentY;

  return Math.hypot(projectedPoint.x - closestX, projectedPoint.y - closestY);
}

function projectToMeters(coordinate: Coordinate, origin: Coordinate) {
  const longitudeScale = METERS_PER_DEGREE_LATITUDE * Math.cos(toRadians(origin[1]));

  return {
    x: (coordinate[0] - origin[0]) * longitudeScale,
    y: (coordinate[1] - origin[1]) * METERS_PER_DEGREE_LATITUDE,
  };
}

function strongestSignal(signals: WeightedSignal[]) {
  return signals.sort(compareSignals)[0] ?? null;
}

function compareSignals(left: WeightedSignal, right: WeightedSignal) {
  const magnitudeDelta = Math.abs(right.delta) - Math.abs(left.delta);
  if (magnitudeDelta !== 0) {
    return magnitudeDelta;
  }

  return signalKindOrder.indexOf(left.kind) - signalKindOrder.indexOf(right.kind);
}

function normalizeText(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function clampScore(value: number): Score {
  if (value <= 1) {
    return 1;
  }

  if (value >= 5) {
    return 5;
  }

  if (value === 2) {
    return 2;
  }

  if (value === 3) {
    return 3;
  }

  return 4;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
