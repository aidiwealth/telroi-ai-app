CREATE TABLE IF NOT EXISTS "auto_topup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_ledger_id" uuid,
	"payment_method_id" uuid,
	"payment_id" uuid,
	"idempotency_key" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"balance_at_trigger_minor" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_attempts" ADD CONSTRAINT "auto_topup_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_attempts" ADD CONSTRAINT "auto_topup_attempts_trigger_ledger_id_ledger_id_fk" FOREIGN KEY ("trigger_ledger_id") REFERENCES "public"."ledger"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_attempts" ADD CONSTRAINT "auto_topup_attempts_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_attempts" ADD CONSTRAINT "auto_topup_attempts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_topup_attempts_idempotency_idx" ON "auto_topup_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_topup_attempts_trigger_idx" ON "auto_topup_attempts" USING btree ("trigger_ledger_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_topup_attempts_payment_idx" ON "auto_topup_attempts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_topup_attempts_due_idx" ON "auto_topup_attempts" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_topup_attempts_tenant_created_idx" ON "auto_topup_attempts" USING btree ("tenant_id","created_at");