ALTER TABLE "payment_methods" ADD COLUMN "source_payment_reference" text;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "source_payment_created_at" timestamp with time zone;