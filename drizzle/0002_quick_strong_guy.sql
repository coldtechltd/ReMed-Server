ALTER TABLE "dosage_forms" ADD COLUMN "quantity_on_hand" integer;--> statement-breakpoint
ALTER TABLE "dosage_forms" ADD COLUMN "refill_threshold" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "dosage_forms" ADD COLUMN "low_stock_alert_sent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "dose_events" ADD COLUMN "snooze_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "timezone" varchar(64) DEFAULT 'UTC';