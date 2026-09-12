ALTER TABLE "auto_topup_attempts" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "auto_topup_attempts" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "auto_topup_attempts" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_topup_attempts_active_tenant_idx" ON "auto_topup_attempts" USING btree ("tenant_id") WHERE "auto_topup_attempts"."status" in ('pending', 'processing', 'ready');