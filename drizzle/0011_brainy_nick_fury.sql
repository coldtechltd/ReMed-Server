CREATE TABLE "companion_codes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"rotated_at" timestamp
);
--> statement-breakpoint
DROP INDEX "companion_links_code_idx";--> statement-breakpoint
ALTER TABLE "companion_links" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "companion_codes" ADD CONSTRAINT "companion_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_codes_code_idx" ON "companion_codes" USING btree ("code");--> statement-breakpoint
ALTER TABLE "companion_links" DROP COLUMN "invite_code_hash";--> statement-breakpoint
ALTER TABLE "companion_links" DROP COLUMN "expires_at";