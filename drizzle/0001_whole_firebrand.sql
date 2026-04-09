CREATE TABLE "conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "conditions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "dose_events" ADD COLUMN "scheduled_for" timestamp DEFAULT now() NOT NULL;