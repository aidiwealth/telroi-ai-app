-- Drizzle wraps this migration in a transaction. Drain old workers first.
-- Duplicate active attempts abort the upgrade without discarding history.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "auto_topup_attempts" ADD COLUMN IF NOT EXISTS "payment_mode" text;--> statement-breakpoint
ALTER TABLE "auto_topup_attempts" ADD COLUMN IF NOT EXISTS "credential_fingerprint" text;--> statement-breakpoint
ALTER TABLE "auto_topup_attempts" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auto_topup_settings" ADD COLUMN IF NOT EXISTS "consent_version" text;--> statement-breakpoint
ALTER TABLE "auto_topup_settings" ADD COLUMN IF NOT EXISTS "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auto_topup_settings" ADD COLUMN IF NOT EXISTS "consented_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "auto_topup_settings" ADD COLUMN IF NOT EXISTS "consented_by_email" text;--> statement-breakpoint
-- Earlier settings without recorded consent require the owner to enable again.
UPDATE "auto_topup_settings" SET "enabled" = false, "updated_at" = now()
WHERE "enabled" AND ("consent_version" IS NULL OR "consented_at" IS NULL OR "consented_by_email" IS NULL);
--> statement-breakpoint
-- Normalize the equivalent FK created by the temporary update, if present.
ALTER TABLE "auto_topup_settings" DROP CONSTRAINT IF EXISTS "auto_topup_settings_consented_by_user_id_fkey";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_settings" ADD CONSTRAINT "auto_topup_settings_consented_by_user_id_users_id_fk" FOREIGN KEY ("consented_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "auto_topup_attempts_active_tenant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "auto_topup_attempts_active_tenant_idx" ON "auto_topup_attempts" USING btree ("tenant_id") WHERE "auto_topup_attempts"."status" in ('pending', 'processing', 'ready', 'dispatching', 'uncertain', 'needs_review');--> statement-breakpoint
ALTER TABLE "auto_topup_settings" DROP CONSTRAINT IF EXISTS "auto_topup_enabled_consent_check";--> statement-breakpoint
ALTER TABLE "auto_topup_settings" ADD CONSTRAINT "auto_topup_enabled_consent_check" CHECK (
    not "auto_topup_settings"."enabled" or ("auto_topup_settings"."consent_version" is not null and "auto_topup_settings"."consented_at" is not null and "auto_topup_settings"."consented_by_email" is not null)
  );
