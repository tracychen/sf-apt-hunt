CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facebook_listing_capture" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_surface" text NOT NULL,
	"source_group_id" text NOT NULL,
	"source_group_name" text NOT NULL,
	"source_group_url" text NOT NULL,
	"source_post_url" text NOT NULL,
	"captured_text" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"parsed_draft" jsonb,
	"reviewed_details" jsonb,
	"incomplete_flags" jsonb NOT NULL,
	"listing_lead_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"query_hash" text NOT NULL,
	"query" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_workspace_query_hash_unique" UNIQUE("workspace_id","query_hash")
);
--> statement-breakpoint
CREATE TABLE "listing_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_search_query" text NOT NULL,
	"seen_count" integer NOT NULL,
	"status" text NOT NULL,
	"candidate" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_lead_workspace_canonical_url_unique" UNIQUE("workspace_id","canonical_url")
);
--> statement-breakpoint
CREATE TABLE "map_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" text NOT NULL,
	"map_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_snapshot_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "planning_action_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"action_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_action_execution_idempotency_unique" UNIQUE("action_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "planning_action" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"part_index" integer NOT NULL,
	"kind" text NOT NULL,
	"target" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"failure_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_message" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"context_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"listing_ledger_revision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_listing_capture" ADD CONSTRAINT "facebook_listing_capture_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_listing_capture" ADD CONSTRAINT "facebook_listing_capture_listing_lead_id_listing_lead_id_fk" FOREIGN KEY ("listing_lead_id") REFERENCES "public"."listing_lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geocode_cache_entry" ADD CONSTRAINT "geocode_cache_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_lead" ADD CONSTRAINT "listing_lead_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_snapshot" ADD CONSTRAINT "map_snapshot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_action_execution" ADD CONSTRAINT "planning_action_execution_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_action_execution" ADD CONSTRAINT "planning_action_execution_action_id_planning_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."planning_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_action" ADD CONSTRAINT "planning_action_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_action" ADD CONSTRAINT "planning_action_thread_id_planning_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."planning_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_action" ADD CONSTRAINT "planning_action_message_id_planning_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."planning_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_message" ADD CONSTRAINT "planning_message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_message" ADD CONSTRAINT "planning_message_thread_id_planning_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."planning_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_thread" ADD CONSTRAINT "planning_thread_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "facebook_capture_workspace_created_idx" ON "facebook_listing_capture" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_lead_workspace_status_idx" ON "listing_lead" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "planning_action_execution_workspace_action_idx" ON "planning_action_execution" USING btree ("workspace_id","action_id");--> statement-breakpoint
CREATE INDEX "planning_action_workspace_thread_status_idx" ON "planning_action" USING btree ("workspace_id","thread_id","status");--> statement-breakpoint
CREATE INDEX "planning_message_workspace_thread_created_idx" ON "planning_message" USING btree ("workspace_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "planning_thread_workspace_updated_idx" ON "planning_thread" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");