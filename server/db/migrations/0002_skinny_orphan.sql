CREATE TABLE IF NOT EXISTS "auto_topup_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"payment_method_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"threshold_minor" integer NOT NULL,
	"topup_amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_settings" ADD CONSTRAINT "auto_topup_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_topup_settings" ADD CONSTRAINT "auto_topup_settings_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_topup_payment_method_idx" ON "auto_topup_settings" USING btree ("payment_method_id");