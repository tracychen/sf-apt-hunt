import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import type {
  GeocodeCacheEntry,
  ListingCandidate,
  MapState,
  OnboardingProgress,
  PlanningActionTarget,
  PlanningChatPart,
  PlanningContextSummary,
} from "@/lib/domain/types";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    listingLedgerRevision: text("listing_ledger_revision").notNull(),
    onboardingProgress: jsonb("onboarding_progress").$type<OnboardingProgress | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("workspace_user_id_unique").on(table.userId)],
);

export const mapSnapshots = pgTable(
  "map_snapshot",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: text("revision").notNull(),
    mapState: jsonb("map_state").$type<MapState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("map_snapshot_workspace_id_unique").on(table.workspaceId)],
);

export const listingLeads = pgTable(
  "listing_lead",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastSearchQuery: text("last_search_query").notNull(),
    seenCount: integer("seen_count").notNull(),
    status: text("status", { enum: ["new", "seen", "saved", "dismissed"] }).notNull(),
    candidate: jsonb("candidate").$type<ListingCandidate>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("listing_lead_workspace_canonical_url_unique").on(
      table.workspaceId,
      table.canonicalUrl,
    ),
    index("listing_lead_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const planningThreads = pgTable(
  "planning_thread",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("planning_thread_workspace_updated_idx").on(table.workspaceId, table.updatedAt)],
);

export const planningMessages = pgTable(
  "planning_message",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => planningThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: jsonb("parts").$type<PlanningChatPart[]>().notNull(),
    contextSummary: jsonb("context_summary").$type<PlanningContextSummary>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("planning_message_workspace_thread_created_idx").on(
      table.workspaceId,
      table.threadId,
      table.createdAt,
    ),
  ],
);

export const planningActions = pgTable(
  "planning_action",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => planningThreads.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => planningMessages.id, { onDelete: "cascade" }),
    partIndex: integer("part_index").notNull(),
    kind: text("kind", {
      enum: ["mapProposal", "mapProposalItem", "listingSave", "listingDismiss", "targetEdit"],
    }).notNull(),
    target: jsonb("target").$type<PlanningActionTarget>().notNull(),
    status: text("status", { enum: ["pending", "applied", "dismissed", "failed"] }).notNull(),
    error: text("error"),
    failureKind: text("failure_kind", { enum: ["retryable", "permanent"] }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("planning_action_workspace_thread_status_idx").on(
      table.workspaceId,
      table.threadId,
      table.status,
    ),
  ],
);

export const planningActionExecutions = pgTable(
  "planning_action_execution",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actionId: text("action_id")
      .notNull()
      .references(() => planningActions.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["in_progress", "succeeded", "failed"] }).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("planning_action_execution_idempotency_unique").on(
      table.actionId,
      table.idempotencyKey,
    ),
    index("planning_action_execution_workspace_action_idx").on(table.workspaceId, table.actionId),
  ],
);

export const geocodeCacheEntries = pgTable(
  "geocode_cache_entry",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    queryHash: text("query_hash").notNull(),
    query: text("query").notNull(),
    result: jsonb("result").$type<GeocodeCacheEntry["result"]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("geocode_cache_workspace_query_hash_unique").on(table.workspaceId, table.queryHash),
  ],
);

export type HousingDetails = {
  listingType: "full_apartment" | "private_room" | "shared_room" | "roommate_search" | "unknown";
  tenancyType: "new_lease" | "lease_takeover" | "sublet" | "month_to_month" | "unknown";
  priceMonthly: number | null;
  bedrooms: number | "studio" | null;
  bathroom: "private" | "shared" | "unknown";
  roommateCount: number | null;
  locationText: string | null;
  neighborhoodGuess: string;
  availabilityStart: string | null;
  availabilityEnd: string | null;
  dateFlexibility: "fixed" | "flexible" | "unknown";
  durationText: string | null;
  furnished: boolean | null;
  pets: "allowed" | "not_allowed" | "unknown";
};

export const facebookListingCaptures = pgTable(
  "facebook_listing_capture",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceSurface: text("source_surface", {
      enum: ["homeFeed", "groupFeed", "postPermalink"],
    }).notNull(),
    sourceGroupId: text("source_group_id").notNull(),
    sourceGroupName: text("source_group_name").notNull(),
    sourceGroupUrl: text("source_group_url").notNull(),
    sourcePostUrl: text("source_post_url").notNull(),
    capturedText: text("captured_text").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    parsedDraft: jsonb("parsed_draft").$type<HousingDetails>(),
    reviewedDetails: jsonb("reviewed_details").$type<HousingDetails>(),
    incompleteFlags: jsonb("incomplete_flags").$type<string[]>().notNull(),
    listingLeadId: text("listing_lead_id").references(() => listingLeads.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("facebook_capture_workspace_created_idx").on(table.workspaceId, table.createdAt)],
);
