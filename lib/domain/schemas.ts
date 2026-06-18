import { z } from "zod";

import type {
  CorridorGeometryQuality,
  GeocodeAuthorization,
  LineStringGeometry,
  ListingCandidate,
  ListingLead,
  ListingSearchResponse,
  MapAssistantOutcome,
  MapPatchProposal,
  MapState,
  MapZone,
  PolygonGeometry,
  ResearchExclusion,
  ResearchExclusionReason,
  ResearchSummary,
  ResearchSummaryItem,
  ResearchedCorridorCandidate,
  ResearchedCorridorGeometryCandidate,
  ResearchedCorridorGeometrySourceFormat,
  ResearchedCorridorModelLineStringGeometryCandidate,
  ResearchedCorridorOrderedWaypointsGeometryCandidate,
  ResearchedCorridorSourceUrlGeometryCandidate,
  ResearchedCorridorWaypointCandidate,
  ResearchedTargetCandidate,
  SourceCitation,
  TargetCorridor,
  TargetPoint,
} from "@/lib/domain/types";
import { isCoordinateInSfBounds } from "@/lib/map/sf-bounds";
import { validateResearchSummaryCorrelation } from "@/lib/map/research-summary";

const coordinateSchema = z.tuple([z.number(), z.number()]);
const targetCoordinateSchema = coordinateSchema.refine(
  (coordinate) => isCoordinateInSfBounds(coordinate),
  "Target coordinates must be inside San Francisco bounds.",
);

const scoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const prioritySchema = z.enum(["high", "medium", "low"]);
const targetInfluenceSchema = z.enum(["positive", "negative", "neutral"]);
const targetRadiusMinutesSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
]);

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 160;
const MAX_TEXT_LENGTH = 2_000;
const MAX_LONG_TEXT_LENGTH = 4_000;
const MAX_URL_LENGTH = 2_048;
const MAX_GEOCODE_AUTH_NONCE_LENGTH = 4_096;
const MAX_NOTES = 50;
const MAX_TAGS = 5;
const MAX_POLYGON_RINGS = 8;
const MAX_POLYGON_RING_POINTS = 200;
const MAX_LINE_POINTS = 200;
const MAX_ALLOWED_GEOCODE_QUERIES = 10;
const MAX_LISTING_CANDIDATES = 100;
const MAX_CITATIONS = 50;
const MAX_CAVEATS = 50;
const MAX_PROPOSAL_OPERATIONS = 50;
const MAX_RESEARCH_SUMMARY_EXCLUSIONS = 100;
const MAX_MISSING_INFORMATION_ITEMS = 20;
export const MAX_RESEARCHED_TARGET_CANDIDATES = 20;
export const MAX_RESEARCHED_CORRIDOR_CANDIDATES = 5;
const MAX_RESEARCHED_CORRIDOR_WAYPOINTS = 25;
const MAX_MAP_ZONES = 100;
const MAX_MAP_CORRIDORS = 100;
const MAX_MAP_TARGETS = 200;

const idSchema = z.string().min(1).max(MAX_ID_LENGTH);
const nameSchema = z.string().min(1).max(MAX_NAME_LENGTH);
const textSchema = z.string().max(MAX_TEXT_LENGTH);
const requiredTextSchema = z.string().min(1).max(MAX_TEXT_LENGTH);
const longTextSchema = z.string().max(MAX_LONG_TEXT_LENGTH);
const requiredLongTextSchema = z.string().min(1).max(MAX_LONG_TEXT_LENGTH);
const urlSchema = z.string().url({ protocol: /^https?$/ }).max(MAX_URL_LENGTH);
const listingCanonicalKeySchema = z
  .string()
  .min(1)
  .max(MAX_URL_LENGTH)
  .refine((value) => value === value.trim(), "Listing canonical key must be trimmed.");
const geocodeAuthNonceSchema = z.string().min(1).max(MAX_GEOCODE_AUTH_NONCE_LENGTH);
const notesSchema = z.array(textSchema).max(MAX_NOTES);

export const polygonGeometrySchema: z.ZodType<PolygonGeometry> = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(coordinateSchema).min(4).max(MAX_POLYGON_RING_POINTS))
    .min(1)
    .max(MAX_POLYGON_RINGS),
});

export const lineStringGeometrySchema: z.ZodType<LineStringGeometry> = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(coordinateSchema).min(2).max(MAX_LINE_POINTS),
});

export const mapZoneSchema: z.ZodType<MapZone> = z.object({
  id: idSchema,
  name: nameSchema,
  kind: z.enum(["neighborhood", "caution"]),
  geometry: polygonGeometrySchema,
  fitnessScore: scoreSchema,
  affordabilityScore: scoreSchema,
  carFreeScore: scoreSchema,
  notes: notesSchema,
});

export const targetCorridorSchema: z.ZodType<TargetCorridor> = z.object({
  id: idSchema,
  name: nameSchema,
  geometry: lineStringGeometrySchema,
  priority: prioritySchema,
  tags: z.array(z.enum(["fitness", "rent", "transit", "safety", "short-term"])).max(MAX_TAGS),
  notes: notesSchema,
});

export const targetPointSchema: z.ZodType<TargetPoint> = z.object({
  id: idSchema,
  name: nameSchema,
  purpose: requiredTextSchema,
  coordinates: targetCoordinateSchema,
  priority: prioritySchema,
  influence: targetInfluenceSchema,
  radiusMinutes: targetRadiusMinutesSchema,
  notes: notesSchema,
});

export const sourceCitationSchema: z.ZodType<SourceCitation> = z.object({
  url: urlSchema,
  title: textSchema.nullable(),
  sourceDomain: idSchema,
});

const researchConfidenceSchema = z.enum(["high", "medium", "low"]);
const corridorGeometryQualitySchema: z.ZodType<CorridorGeometryQuality> = z.enum([
  "official",
  "fromStops",
  "approximate",
]);
const researchExclusionReasonSchema: z.ZodType<ResearchExclusionReason> = z.enum([
  "duplicate",
  "out_of_bounds",
  "geocode_failed",
  "missing_source",
  "invalid_geometry",
  "over_cap",
]);
const researchedCorridorGeometrySourceFormatSchema: z.ZodType<ResearchedCorridorGeometrySourceFormat> =
  z.enum(["gtfs", "geojson", "kml", "polyline", "unknown"]);

export const researchSummaryItemSchema: z.ZodType<ResearchSummaryItem> = z.object({
  entityId: idSchema,
  operationType: z.enum(["addTarget", "addCorridor"]),
  label: nameSchema,
  source: sourceCitationSchema,
  confidence: researchConfidenceSchema,
  geometryQuality: corridorGeometryQualitySchema.optional(),
  geocodePrecision: z.enum(["exact", "approximate"]).optional(),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});

export const researchExclusionSchema: z.ZodType<ResearchExclusion> = z.object({
  label: nameSchema,
  reason: researchExclusionReasonSchema,
  source: sourceCitationSchema.optional(),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});

export const researchSummarySchema: z.ZodType<ResearchSummary> = z.object({
  items: z.array(researchSummaryItemSchema).max(MAX_PROPOSAL_OPERATIONS),
  exclusions: z.array(researchExclusionSchema).max(MAX_RESEARCH_SUMMARY_EXCLUSIONS),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
});

export const researchedTargetCandidateSchema: z.ZodType<ResearchedTargetCandidate> = z
  .object({
    id: idSchema,
    name: nameSchema,
    address: requiredTextSchema.nullable(),
    geocodeQuery: requiredTextSchema,
    source: sourceCitationSchema,
    purpose: requiredTextSchema,
    influence: targetInfluenceSchema,
    priority: prioritySchema,
    radiusMinutes: targetRadiusMinutesSchema,
    confidence: researchConfidenceSchema,
    caveats: z.array(textSchema).max(MAX_CAVEATS),
  })
  .strict();

export const researchedTargetCandidatesSchema = z
  .array(researchedTargetCandidateSchema)
  .max(MAX_RESEARCHED_TARGET_CANDIDATES);

const researchedCorridorSourceUrlGeometryCandidateObject = z
  .object({
    kind: z.literal("sourceUrl"),
    url: urlSchema,
    format: researchedCorridorGeometrySourceFormatSchema,
  })
  .strict();

export const researchedCorridorSourceUrlGeometryCandidateSchema: z.ZodType<ResearchedCorridorSourceUrlGeometryCandidate> =
  researchedCorridorSourceUrlGeometryCandidateObject;

export const researchedCorridorWaypointCandidateSchema: z.ZodType<ResearchedCorridorWaypointCandidate> =
  z
    .object({
      label: nameSchema,
      geocodeQuery: requiredTextSchema,
    })
    .strict();

const researchedCorridorOrderedWaypointsGeometryCandidateObject = z
  .object({
    kind: z.literal("orderedWaypoints"),
    waypoints: z
      .array(researchedCorridorWaypointCandidateSchema)
      .min(2)
      .max(MAX_RESEARCHED_CORRIDOR_WAYPOINTS),
  })
  .strict();

export const researchedCorridorOrderedWaypointsGeometryCandidateSchema: z.ZodType<ResearchedCorridorOrderedWaypointsGeometryCandidate> =
  researchedCorridorOrderedWaypointsGeometryCandidateObject;

const researchedCorridorModelLineStringGeometryCandidateObject = z
  .object({
    kind: z.literal("modelLineString"),
    coordinates: z.array(coordinateSchema).min(2).max(MAX_LINE_POINTS),
    caveat: requiredTextSchema,
  })
  .strict();

export const researchedCorridorModelLineStringGeometryCandidateSchema: z.ZodType<ResearchedCorridorModelLineStringGeometryCandidate> =
  researchedCorridorModelLineStringGeometryCandidateObject;

export const researchedCorridorGeometryCandidateSchema: z.ZodType<ResearchedCorridorGeometryCandidate> =
  z.discriminatedUnion("kind", [
    researchedCorridorSourceUrlGeometryCandidateObject,
    researchedCorridorOrderedWaypointsGeometryCandidateObject,
    researchedCorridorModelLineStringGeometryCandidateObject,
  ]);

export const researchedCorridorCandidateSchema: z.ZodType<ResearchedCorridorCandidate> = z
  .object({
    id: idSchema,
    name: nameSchema,
    source: sourceCitationSchema,
    priority: prioritySchema,
    tags: z.array(z.enum(["fitness", "rent", "transit", "safety", "short-term"])).max(MAX_TAGS),
    notes: notesSchema,
    confidence: researchConfidenceSchema,
    requestedGeometryQuality: corridorGeometryQualitySchema,
    geometry: researchedCorridorGeometryCandidateSchema,
    caveats: z.array(textSchema).max(MAX_CAVEATS),
  })
  .strict();

export const researchedCorridorCandidatesSchema = z
  .array(researchedCorridorCandidateSchema)
  .max(MAX_RESEARCHED_CORRIDOR_CANDIDATES);

export const geocodeAuthorizationSchema: z.ZodType<GeocodeAuthorization> = z.object({
  nonce: geocodeAuthNonceSchema,
  expiresAt: z.string().datetime(),
  maxAttempts: z.number().int().positive(),
  allowedQueries: z.array(
    z.object({
      candidateId: idSchema,
      geocodeQueryHash: idSchema,
    }),
  ).max(MAX_ALLOWED_GEOCODE_QUERIES),
});

const listingCandidateShape = {
  id: idSchema,
  title: nameSchema,
  url: urlSchema,
  sourceDomain: idSchema,
  neighborhoodGuess: nameSchema,
  locationText: textSchema.nullable(),
  geocodeQuery: textSchema.nullable(),
  locationConfidence: z.enum(["none", "low", "medium", "high"]),
  coordinates: coordinateSchema.nullable(),
  geocodeStatus: z.enum([
    "not_attempted",
    "geocoded_exact",
    "geocoded_approximate",
    "failed",
    "outside_sf",
  ]),
  markerPrecision: z.enum(["none", "exact", "approximate"]),
  priceMonthly: z.number().int().positive().nullable(),
  beds: z.enum(["studio", "1br", "unknown"]),
  shortTermSignal: z.boolean(),
  furnishedSignal: z.boolean(),
  fitScore: scoreSchema,
  whyItFits: requiredTextSchema,
  citations: z.array(sourceCitationSchema).min(1).max(MAX_CITATIONS),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
};

export const listingCandidateSchema: z.ZodType<ListingCandidate> = z.object(
  listingCandidateShape,
);

export const listingSearchFiltersSchema = z.object({
  maxBudget: z.number().int().positive().nullable(),
  beds: z.enum(["any", "studio", "1br"]),
  timing: textSchema,
  shortTerm: z.boolean(),
  furnished: z.boolean(),
});

export const listingLeadStatusSchema = z.enum(["new", "seen"]);
const persistedListingCandidateSchema: z.ZodType<ListingCandidate> = z.object({
  ...listingCandidateShape,
  url: listingCanonicalKeySchema,
});

export const listingLeadSchema: z.ZodType<ListingLead> = z.object({
  canonicalUrl: listingCanonicalKeySchema,
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  lastSearchQuery: textSchema,
  seenCount: z.number().int().positive(),
  status: listingLeadStatusSchema,
  candidate: persistedListingCandidateSchema,
});

export const listingSearchResponseSchema: z.ZodType<ListingSearchResponse> = z.object({
  candidates: z.array(listingCandidateSchema).max(MAX_LISTING_CANDIDATES),
  sourceSummary: longTextSchema,
  citations: z.array(sourceCitationSchema).max(MAX_CITATIONS),
  caveats: z.array(textSchema).max(MAX_CAVEATS),
  geocodeAuthorization: geocodeAuthorizationSchema.nullable(),
});

const updateTargetPlanningFieldsOperationSchema = z.object({
  type: z.literal("updateTargetPlanningFields"),
  targetId: idSchema,
  name: nameSchema.optional(),
  purpose: requiredTextSchema.optional(),
  influence: targetInfluenceSchema.optional(),
  priority: prioritySchema.optional(),
  radiusMinutes: targetRadiusMinutesSchema.optional(),
  notes: notesSchema.optional(),
  reason: requiredTextSchema,
});

export const mapPatchProposalSchema: z.ZodType<MapPatchProposal> = z.object({
  summary: requiredLongTextSchema,
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("addTarget"), target: targetPointSchema }),
      z.object({ type: z.literal("addCorridor"), corridor: targetCorridorSchema }),
      z.object({
        type: z.literal("updateCorridorPriority"),
        corridorId: idSchema,
        priority: prioritySchema,
        reason: requiredTextSchema,
      }),
      z.object({
        type: z.literal("updateTargetPriority"),
        targetId: idSchema,
        priority: prioritySchema,
        reason: requiredTextSchema,
      }),
      updateTargetPlanningFieldsOperationSchema,
      z.object({
        type: z.literal("updateZoneScores"),
        zoneId: idSchema,
        fitnessScore: scoreSchema.optional(),
        affordabilityScore: scoreSchema.optional(),
        carFreeScore: scoreSchema.optional(),
      }),
      z.object({
        type: z.literal("replaceZoneGeometry"),
        zoneId: idSchema,
        geometry: polygonGeometrySchema,
        reason: requiredTextSchema,
      }),
      z.object({
        type: z.literal("addNote"),
        entityId: idSchema,
        note: requiredTextSchema,
      }),
    ]),
  ).max(MAX_PROPOSAL_OPERATIONS),
  confidence: z.enum(["low", "medium", "high"]),
  requiresUserReview: z.literal(true),
}).superRefine((proposal, context) => {
  proposal.operations.forEach((operation, index) => {
    if (operation.type !== "updateTargetPlanningFields") {
      return;
    }

    const hasTargetField =
      operation.name !== undefined ||
      operation.purpose !== undefined ||
      operation.influence !== undefined ||
      operation.priority !== undefined ||
      operation.radiusMinutes !== undefined ||
      operation.notes !== undefined;

    if (!hasTargetField) {
      context.addIssue({
        code: "custom",
        path: ["operations", index],
        message: "At least one target planning field must be provided.",
      });
    }
  });
});

export const mapAssistantOutcomeSchema: z.ZodType<MapAssistantOutcome> = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("needsMoreInfo"),
        assistantMessage: requiredLongTextSchema,
        missingInformation: z
          .array(requiredTextSchema)
          .min(1)
          .max(MAX_MISSING_INFORMATION_ITEMS),
      })
      .strict(),
    z
      .object({
        kind: z.literal("proposal"),
        assistantMessage: requiredLongTextSchema,
        proposal: mapPatchProposalSchema,
        researchSummary: researchSummarySchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("noAction"),
        assistantMessage: requiredLongTextSchema,
        caveats: z.array(textSchema).max(MAX_CAVEATS),
      })
      .strict(),
  ])
  .superRefine((outcome, context) => {
    if (outcome.kind !== "proposal") {
      return;
    }

    const correlation = validateResearchSummaryCorrelation({
      proposal: outcome.proposal,
      researchSummary: outcome.researchSummary,
      requireMetadataForAllResearchOperations: false,
    });

    if (!correlation.ok) {
      context.addIssue({
        code: "custom",
        path: ["researchSummary", "items"],
        message: correlation.error,
      });
    }
  });

export const mapStateSchema: z.ZodType<MapState> = z.object({
  zones: z.array(mapZoneSchema).max(MAX_MAP_ZONES),
  corridors: z.array(targetCorridorSchema).max(MAX_MAP_CORRIDORS),
  targets: z.array(targetPointSchema).max(MAX_MAP_TARGETS),
});
