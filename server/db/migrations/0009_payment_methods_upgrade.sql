-- Upgrade pre-migration installations too; 0000 only creates missing tables.
-- Stop old web/worker processes before migrating. Never discard duplicate cards.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "payment_methods" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "payment_methods"
  ADD COLUMN IF NOT EXISTS "token_enc" text,
  ADD COLUMN IF NOT EXISTS "provider_customer_id" text,
  ADD COLUMN IF NOT EXISTS "billing_email" text,
  ADD COLUMN IF NOT EXISTS "provider_signature" text,
  ADD COLUMN IF NOT EXISTS "reusable" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Keep legacy tokens intact, but do not treat them as verified reusable cards.
ALTER TABLE "payment_methods" ALTER COLUMN "token" DROP NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "payment_methods" GROUP BY "tenant_id" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Multiple saved payment methods exist for a workspace. Resolve duplicates explicitly before retrying migrations; no cards have been deleted.';
  END IF;
END $$;
--> statement-breakpoint
-- The old index has this same name but is NOT unique. IF NOT EXISTS is insufficient.
DROP INDEX IF EXISTS "payment_methods_tenant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_tenant_idx" ON "payment_methods" ("tenant_id");
