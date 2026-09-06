CREATE TABLE "companion_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"companion_id" uuid,
	"invite_code_hash" varchar(64),
	"label" varchar(100),
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"notify_missed_dose" boolean DEFAULT true NOT NULL,
	"notify_refill" boolean DEFAULT true NOT NULL,
	"invited_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" uuid,
	"last_viewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "dose_events" ADD COLUMN "companion_alert_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companion_links" ADD CONSTRAINT "companion_links_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_links" ADD CONSTRAINT "companion_links_companion_id_users_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companion_links_owner_status_idx" ON "companion_links" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "companion_links_companion_status_idx" ON "companion_links" USING btree ("companion_id","status");--> statement-breakpoint
CREATE INDEX "companion_links_code_idx" ON "companion_links" USING btree ("invite_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_links_active_pair_idx" ON "companion_links" USING btree ("owner_id","companion_id") WHERE "companion_links"."status" = 'active';--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_code_unique" UNIQUE("code");