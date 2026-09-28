CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"pending_action" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"generic_name" varchar(255),
	"source" varchar(50) DEFAULT 'curated' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "medication_names_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" varchar(50) NOT NULL,
	"ref_id" uuid,
	"push_token" varchar(255),
	"ticket_id" varchar(255),
	"status" varchar(20) NOT NULL,
	"error_code" varchar(100),
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"dose_reminders_enabled" boolean DEFAULT true NOT NULL,
	"refill_reminders_enabled" boolean DEFAULT true NOT NULL,
	"companion_alerts_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" varchar(5) DEFAULT '22:00',
	"quiet_hours_end" varchar(5) DEFAULT '07:00',
	"default_snooze_minutes" integer DEFAULT 15 NOT NULL,
	"timezone" varchar(64),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "device_sessions" ADD COLUMN "local_reminders" jsonb;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD COLUMN "local_reminders_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "dose_events" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "cycle_on_days" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "cycle_off_days" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "cycle_anchor_date" timestamp;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_messages_user_created_idx" ON "ai_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "medication_names_name_idx" ON "medication_names" USING btree ("name");--> statement-breakpoint
CREATE INDEX "medication_names_generic_idx" ON "medication_names" USING btree ("generic_name");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_sent_idx" ON "notification_deliveries" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_ticket_idx" ON "notification_deliveries" USING btree ("ticket_id");