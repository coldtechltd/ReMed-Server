CREATE TABLE "ai_tips_cache" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tips" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_tips_cache" ADD CONSTRAINT "ai_tips_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dosage_forms_medication_id_idx" ON "dosage_forms" USING btree ("medication_id");--> statement-breakpoint
CREATE INDEX "dose_events_schedule_status_due_idx" ON "dose_events" USING btree ("schedule_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "dose_events_status_due_idx" ON "dose_events" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "medications_user_id_status_idx" ON "medications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "schedules_dosage_form_id_idx" ON "schedules" USING btree ("dosage_form_id");--> statement-breakpoint
CREATE INDEX "schedules_is_active_idx" ON "schedules" USING btree ("is_active");