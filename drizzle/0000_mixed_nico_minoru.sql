CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(10) NOT NULL,
	"call_code" varchar(10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dosage_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medication_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(100) NOT NULL,
	"dosage_amount" integer NOT NULL,
	"dosage_unit" varchar(50) DEFAULT 'pills',
	"route" varchar(100) DEFAULT 'oral',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dose_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"taken_at" timestamp,
	"status" varchar(50) DEFAULT 'pending',
	"reminder_sent" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"expo_push_token" varchar(255),
	"oauth_provider" varchar(50),
	"oauth_id" varchar(255),
	"oauth_access_token" text,
	"oauth_refresh_token" text,
	"oauth_token_expires_at" timestamp,
	"token_version" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"date_of_birth" date,
	"blood_group" varchar(10),
	"genotype" varchar(10),
	"height" integer,
	"weight" integer,
	"gender" varchar(50),
	"country_id" uuid NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"diagnosed_with" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"notes" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dosage_form_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"interval_value" integer,
	"interval_unit" varchar(20),
	"specific_times" text[],
	"days_of_week" text[],
	"first_dose_at" timestamp,
	"as_needed" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "dosage_forms" ADD CONSTRAINT "dosage_forms_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_dosage_form_id_dosage_forms_id_fk" FOREIGN KEY ("dosage_form_id") REFERENCES "public"."dosage_forms"("id") ON DELETE no action ON UPDATE no action;