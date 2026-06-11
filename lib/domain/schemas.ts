import { z } from "zod";

import type {
  GeocodeAuthorization,
  LineStringGeometry,
  ListingCandidate,
  ListingSearchResponse,
  MapPatchProposal,
  MapState,
  MapZone,
  PolygonGeometry,
  SourceCitation,
  TargetCorridor,
  TargetPoint,
} from "@/lib/domain/types";

const coordinateSchema = z.tuple([z.number(), z.number()]);

const scoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const prioritySchema = z.enum(["high", "medium", "low"]);

export const polygonGeometrySchema: z.ZodType<PolygonGeometry> = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(coordinateSchema)).min(1),
});

export const lineStringGeometrySchema: z.ZodType<LineStringGeometry> = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(coordinateSchema).min(2),
});

export const mapZoneSchema: z.ZodType<MapZone> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["neighborhood", "caution"]),
  geometry: polygonGeometrySchema,
  fitnessScore: scoreSchema,
  affordabilityScore: scoreSchema,
  carFreeScore: scoreSchema,
  notes: z.array(z.string()),
});

export const targetCorridorSchema: z.ZodType<TargetCorridor> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  geometry: lineStringGeometrySchema,
  priority: prioritySchema,
  tags: z.array(z.enum(["fitness", "rent", "transit", "safety", "short-term"])),
  notes: z.array(z.string()),
});

export const targetPointSchema: z.ZodType<TargetPoint> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  coordinates: coordinateSchema,
  priority: prioritySchema,
  notes: z.array(z.string()),
});

export const sourceCitationSchema: z.ZodType<SourceCitation> = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  sourceDomain: z.string().min(1),
});

export const geocodeAuthorizationSchema: z.ZodType<GeocodeAuthorization> = z.object({
  nonce: z.string().min(1),
  expiresAt: z.string().datetime(),
  maxAttempts: z.number().int().positive(),
  allowedQueries: z.array(
    z.object({
      candidateId: z.string().min(1),
      geocodeQueryHash: z.string().min(1),
    }),
  ),
});

export const listingCandidateSchema: z.ZodType<ListingCandidate> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  sourceDomain: z.string().min(1),
  neighborhoodGuess: z.string().min(1),
  locationText: z.string().nullable(),
  geocodeQuery: z.string().nullable(),
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
  whyItFits: z.string().min(1),
  citations: z.array(sourceCitationSchema).min(1),
  caveats: z.array(z.string()),
});

export const listingSearchResponseSchema: z.ZodType<ListingSearchResponse> = z.object({
  candidates: z.array(listingCandidateSchema),
  sourceSummary: z.string(),
  citations: z.array(sourceCitationSchema),
  caveats: z.array(z.string()),
  geocodeAuthorization: geocodeAuthorizationSchema.nullable(),
});

export const mapPatchProposalSchema: z.ZodType<MapPatchProposal> = z.object({
  summary: z.string().min(1),
  operations: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("addTarget"), target: targetPointSchema }),
      z.object({ type: z.literal("addCorridor"), corridor: targetCorridorSchema }),
      z.object({
        type: z.literal("updateCorridorPriority"),
        corridorId: z.string().min(1),
        priority: prioritySchema,
        reason: z.string().min(1),
      }),
      z.object({
        type: z.literal("updateTargetPriority"),
        targetId: z.string().min(1),
        priority: prioritySchema,
        reason: z.string().min(1),
      }),
      z.object({
        type: z.literal("updateZoneScores"),
        zoneId: z.string().min(1),
        fitnessScore: scoreSchema.optional(),
        affordabilityScore: scoreSchema.optional(),
        carFreeScore: scoreSchema.optional(),
      }),
      z.object({
        type: z.literal("replaceZoneGeometry"),
        zoneId: z.string().min(1),
        geometry: polygonGeometrySchema,
        reason: z.string().min(1),
      }),
      z.object({
        type: z.literal("addNote"),
        entityId: z.string().min(1),
        note: z.string().min(1),
      }),
    ]),
  ),
  confidence: z.enum(["low", "medium", "high"]),
  requiresUserReview: z.literal(true),
});

export const mapStateSchema: z.ZodType<MapState> = z.object({
  zones: z.array(mapZoneSchema),
  corridors: z.array(targetCorridorSchema),
  targets: z.array(targetPointSchema),
});
