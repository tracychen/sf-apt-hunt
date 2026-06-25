import type {
  ListingSearchFilters,
  MapState,
  PlanningActionRecord,
  PlanningChatRequest,
  PlanningContextSummary,
  PlanningMessage,
  SelectedMapEntity,
} from "@/lib/domain/types";
import type { ListingSearchSelectedContext } from "@/lib/server/listing-search-service";

export type PlanningIntent = "listing" | "map";

export type PlanningAppContext = {
  preferences: PlanningContextSummary;
  recentMessages: Array<{
    role: PlanningMessage["role"];
    text: string;
  }>;
  recentActions: Array<{
    kind: PlanningActionRecord["kind"];
    status: PlanningActionRecord["status"];
    targetKind: PlanningActionRecord["target"]["kind"];
  }>;
  selectedEntity: ReturnType<typeof buildSelectedEntityContext>;
};

const listingIntentTerms = ["listing", "studio", "1br", "1 bedroom", "under", "rent", "available"];

export function classifyPlanningIntent(message: string): PlanningIntent {
  const normalized = message.toLowerCase();

  return listingIntentTerms.some((term) => normalized.includes(term)) ? "listing" : "map";
}

export function buildPlanningContextSummary(input: {
  request: PlanningChatRequest;
  mapState: MapState;
  preferenceMemory?: PlanningContextSummary | null;
}): PlanningContextSummary {
  const visibleContext = input.request.visibleContext;
  const selectedZoneNames = collectSelectedZoneNames(input.mapState, input.request);
  const extractedPreferences = extractPlanningMessagePreferences(input.request.message);
  const current: PlanningContextSummary = {
    budget: visibleContext?.budget ?? extractedPreferences.budget ?? null,
    beds: visibleContext?.beds ?? extractedPreferences.beds ?? null,
    timing: visibleContext?.timing ?? extractedPreferences.timing ?? null,
    furnished: visibleContext?.furnished ?? extractedPreferences.furnished ?? null,
    shortTerm: visibleContext?.shortTerm ?? extractedPreferences.shortTerm ?? null,
    positiveAnchors: visibleContext?.positiveAnchors ?? collectTargetNames(input.mapState, "positive"),
    avoidAnchors: visibleContext?.avoidAnchors ?? collectTargetNames(input.mapState, "negative"),
    selectedZones: selectedZoneNames,
    sourceStrictness: visibleContext?.sourceStrictness ?? null,
  };

  return mergePlanningContextSummary(input.preferenceMemory ?? null, current);
}

export function buildListingFilters(context: PlanningContextSummary): ListingSearchFilters {
  return {
    maxBudget: context.budget,
    beds: context.beds ?? "any",
    timing: context.timing ?? "",
    shortTerm: context.shortTerm ?? false,
    furnished: context.furnished ?? false,
  };
}

export function buildSelectedZoneIds(input: {
  mapState: MapState;
  request: PlanningChatRequest;
  context: PlanningContextSummary;
}) {
  const selectedZoneNames = new Set(input.context.selectedZones.map(normalizeText));
  const ids = new Set<string>();

  if (input.request.selectedEntity?.kind === "zone") {
    ids.add(input.request.selectedEntity.id);
  }

  for (const zone of input.mapState.zones) {
    if (selectedZoneNames.has(normalizeText(zone.name))) {
      ids.add(zone.id);
    }
  }

  return [...ids];
}

export function buildListingSelectedContext(input: {
  mapState: MapState;
  selectedZoneIds: string[];
}): ListingSearchSelectedContext {
  const selectedZoneSet = new Set(input.selectedZoneIds);

  return {
    zones: input.mapState.zones
      .filter((zone) => selectedZoneSet.has(zone.id))
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        fitnessScore: zone.fitnessScore,
        affordabilityScore: zone.affordabilityScore,
        carFreeScore: zone.carFreeScore,
        notes: zone.notes,
      })),
    areas: (input.mapState.areas ?? []).map((area) => ({
      id: area.id,
      name: area.name,
      purpose: area.purpose,
      geometry: area.geometry,
      priority: area.priority,
      influence: area.influence,
      notes: area.notes,
    })),
    corridors: input.mapState.corridors.map((corridor) => ({
      id: corridor.id,
      name: corridor.name,
      priority: corridor.priority,
      tags: corridor.tags,
      notes: corridor.notes,
    })),
    targets: input.mapState.targets.map((target) => ({
      id: target.id,
      name: target.name,
      purpose: target.purpose,
      coordinates: target.coordinates,
      priority: target.priority,
      influence: target.influence,
      radiusMinutes: target.radiusMinutes,
      notes: target.notes,
    })),
  };
}

export function buildPlanningAppContext(input: {
  context: PlanningContextSummary;
  mapState: MapState;
  selectedEntity: SelectedMapEntity;
  recentMessages: PlanningMessage[];
  recentActions: PlanningActionRecord[];
}): PlanningAppContext {
  return {
    preferences: input.context,
    recentMessages: input.recentMessages.slice(-6).map((message) => ({
      role: message.role,
      text: summarizeMessageText(message),
    })),
    recentActions: input.recentActions.slice(-8).map((action) => ({
      kind: action.kind,
      status: action.status,
      targetKind: action.target.kind,
    })),
    selectedEntity: buildSelectedEntityContext(input.mapState, input.selectedEntity),
  };
}

export function mergePlanningContextSummary(
  memory: PlanningContextSummary | null,
  current: PlanningContextSummary,
): PlanningContextSummary {
  if (!memory) {
    return current;
  }

  return {
    budget: current.budget ?? memory.budget,
    beds: current.beds ?? memory.beds,
    timing: current.timing ?? memory.timing,
    furnished: current.furnished ?? memory.furnished,
    shortTerm: current.shortTerm ?? memory.shortTerm,
    positiveAnchors:
      current.positiveAnchors.length > 0 ? current.positiveAnchors : memory.positiveAnchors,
    avoidAnchors: current.avoidAnchors.length > 0 ? current.avoidAnchors : memory.avoidAnchors,
    selectedZones: current.selectedZones.length > 0 ? current.selectedZones : memory.selectedZones,
    sourceStrictness: current.sourceStrictness ?? memory.sourceStrictness,
  };
}

function collectSelectedZoneNames(mapState: MapState, request: PlanningChatRequest) {
  const names = new Set(request.visibleContext?.selectedZones ?? []);

  if (request.selectedEntity?.kind === "zone") {
    const zone = mapState.zones.find((item) => item.id === request.selectedEntity?.id);
    if (zone) {
      names.add(zone.name);
    }
  }

  return [...names];
}

function collectTargetNames(mapState: MapState, influence: "positive" | "negative") {
  return mapState.targets
    .filter((target) => target.influence === influence)
    .map((target) => target.name);
}

function extractPlanningMessagePreferences(message: string): Partial<PlanningContextSummary> {
  return {
    budget: extractBudgetPreference(message),
    beds: extractBedsPreference(message),
    timing: extractTimingPreference(message),
    furnished: extractFurnishedPreference(message),
    shortTerm: extractShortTermPreference(message),
  };
}

function extractBudgetPreference(message: string) {
  const amount = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)";
  const cues = [
    new RegExp(`\\b(?:under|below|up[-\\s]?to|upto|at most)\\s+\\$?\\s*${amount}\\s*(k)?\\b`, "i"),
    new RegExp(
      `\\b(?:budget|rent|price|max(?:imum)?(?:\\s+(?:budget|rent|price))?|afford(?:able|ability)?)\\b(?:\\s+\\w+){0,2}\\s+\\$?\\s*${amount}\\s*(k)?\\b`,
      "i",
    ),
    new RegExp(`\\b\\$?\\s*${amount}\\s*(k)?\\s+(?:budget|rent|price|max(?:imum)?)\\b`, "i"),
  ];

  for (const pattern of cues) {
    const match = pattern.exec(message);

    if (!match) {
      continue;
    }

    const numericValue = Number.parseFloat(match[1].replaceAll(",", ""));
    const multiplier = match[2];

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return null;
    }

    return Math.round(multiplier ? numericValue * 1_000 : numericValue);
  }

  return null;
}

function extractBedsPreference(message: string): PlanningContextSummary["beds"] | null {
  if (/\bstudio\b/i.test(message)) {
    return "studio";
  }

  if (/\b1\s*(?:br|bed(?:room)?)\b/i.test(message)) {
    return "1br";
  }

  return null;
}

function extractFurnishedPreference(message: string) {
  if (/\bunfurnished\b/i.test(message)) {
    return false;
  }

  if (/\bfurnished\b/i.test(message)) {
    return true;
  }

  return null;
}

function extractShortTermPreference(message: string) {
  return /\b(?:short[\s-]?term|month[\s-]?to[\s-]?month)\b/i.test(message) ? true : null;
}

function extractTimingPreference(message: string) {
  const immediateMatch =
    /\b(asap|immediately|right away|next month|this month)\b/i.exec(message);

  if (immediateMatch) {
    return immediateMatch[0];
  }

  const timePeriodPattern =
    "(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec|spring|summer|fall|autumn|winter)";
  const detailedDateMatch = new RegExp(
    `\\b${timePeriodPattern}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?\\b`,
    "i",
  ).exec(message);

  if (detailedDateMatch) {
    return detailedDateMatch[1];
  }

  const cueMatch = new RegExp(
    `\\b(?:for|in|starting|start(?:ing)?|move(?:\\s+in)?|moving|available|availability|around|by|from|during|beginning|begin|lease(?:\\s+start)?)\\b(?:\\s+\\w+){0,2}\\s+${timePeriodPattern}\\b`,
    "i",
  ).exec(message);

  return cueMatch?.[1] ?? null;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function summarizeMessageText(message: PlanningMessage) {
  const text = message.parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      if (part.type === "followUpQuestion") {
        return part.question;
      }

      if (part.type === "mapProposal" || part.type === "targetEditProposal") {
        return part.proposal.summary;
      }

      if (part.type === "listingResults") {
        return part.sourceSummary;
      }

      if (part.type === "contextSummary") {
        return JSON.stringify(part.context);
      }

      return part.message;
    })
    .join(" ")
    .trim();

  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function buildSelectedEntityContext(mapState: MapState, selectedEntity: SelectedMapEntity) {
  if (!selectedEntity) {
    return null;
  }

  if (selectedEntity.kind === "zone") {
    const zone = mapState.zones.find((item) => item.id === selectedEntity.id);
    return zone
      ? {
          kind: "zone" as const,
          id: zone.id,
          name: zone.name,
          fitnessScore: zone.fitnessScore,
          affordabilityScore: zone.affordabilityScore,
          carFreeScore: zone.carFreeScore,
          notes: zone.notes.slice(0, 5),
        }
      : null;
  }

  if (selectedEntity.kind === "area") {
    const area = (mapState.areas ?? []).find((item) => item.id === selectedEntity.id);
    return area
      ? {
          kind: "area" as const,
          id: area.id,
          name: area.name,
          purpose: area.purpose,
          priority: area.priority,
          influence: area.influence,
          notes: area.notes.slice(0, 5),
        }
      : null;
  }

  if (selectedEntity.kind === "corridor") {
    const corridor = mapState.corridors.find((item) => item.id === selectedEntity.id);
    return corridor
      ? {
          kind: "corridor" as const,
          id: corridor.id,
          name: corridor.name,
          priority: corridor.priority,
          tags: corridor.tags,
          notes: corridor.notes.slice(0, 5),
        }
      : null;
  }

  const target = mapState.targets.find((item) => item.id === selectedEntity.id);
  return target
    ? {
        kind: "target" as const,
        id: target.id,
        name: target.name,
        purpose: target.purpose,
        priority: target.priority,
        influence: target.influence,
        radiusMinutes: target.radiusMinutes,
        notes: target.notes.slice(0, 5),
      }
    : null;
}
