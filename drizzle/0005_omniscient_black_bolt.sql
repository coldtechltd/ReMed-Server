ALTER TABLE "dosage_forms" ADD COLUMN "refill_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "type" varchar(20) DEFAULT 'continuous' NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
-- Backfill (hand-added): existing rows predate the type/status columns, so derive
-- both from the only signal they had — whether an end date was set, and whether it
-- has already passed. Without this every historical course would read as ongoing.
--
-- NOTE: `drizzle-kit push` (this project's apply path) ignores this file. Run
-- src/db/seeder/backfill-medication-lifecycle.ts to actually apply these.
--
-- The 36-hour margin mirrors the auto-complete cron: end_date is inclusive through
-- end-of-day in the schedule's timezone, up to ~35h after the stored midnight-UTC
-- timestamp for users west of UTC.
UPDATE "medications" SET "type" = CASE WHEN "end_date" IS NULL THEN 'continuous' ELSE 'course' END;--> statement-breakpoint
UPDATE "medications" SET "status" = 'completed', "completed_at" = "end_date"
  WHERE "end_date" IS NOT NULL AND "end_date" < now() - interval '36 hours';