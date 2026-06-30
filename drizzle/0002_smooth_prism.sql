CREATE TABLE "extension_connection_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"extension_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_connection_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "facebook_listing_import_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"capture_id" text NOT NULL,
	"listing_lead_id" text NOT NULL,
	"successful_response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension_connection_token" ADD CONSTRAINT "extension_connection_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_connection_token" ADD CONSTRAINT "extension_connection_token_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_listing_import_attempt" ADD CONSTRAINT "facebook_listing_import_attempt_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_listing_import_attempt" ADD CONSTRAINT "facebook_listing_import_attempt_capture_id_facebook_listing_capture_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."facebook_listing_capture"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_listing_import_attempt" ADD CONSTRAINT "facebook_listing_import_attempt_listing_lead_id_listing_lead_id_fk" FOREIGN KEY ("listing_lead_id") REFERENCES "public"."listing_lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_connection_workspace_extension_idx" ON "extension_connection_token" USING btree ("workspace_id","extension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_import_attempt_workspace_idempotency_unique" ON "facebook_listing_import_attempt" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_capture_workspace_post_url_unique" ON "facebook_listing_capture" USING btree ("workspace_id","source_post_url");