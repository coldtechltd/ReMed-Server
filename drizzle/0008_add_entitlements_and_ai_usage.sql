CREATE TABLE "ai_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tips_calls" integer DEFAULT 0 NOT NULL,
	"chat_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" varchar(20) DEFAULT 'free' NOT NULL,
	"source" varchar(20),
	"product_id" varchar(255),
	"expires_at" timestamp,
	"is_lifetime" boolean DEFAULT false NOT NULL,
	"rc_app_user_id" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;