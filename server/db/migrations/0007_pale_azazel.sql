ALTER TABLE "payments" ADD COLUMN "save_payment_method_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "save_payment_method_consent_version" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "save_payment_method_consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "save_payment_method_consented_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "save_payment_method_consented_by_email" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_save_payment_method_consented_by_user_id_users_id_fk" FOREIGN KEY ("save_payment_method_consented_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_save_method_consent_check" CHECK (
    not "payments"."save_payment_method_requested" or
    ("payments"."save_payment_method_consent_version" is not null and
     "payments"."save_payment_method_consented_at" is not null and
     "payments"."save_payment_method_consented_by_email" is not null)
  );