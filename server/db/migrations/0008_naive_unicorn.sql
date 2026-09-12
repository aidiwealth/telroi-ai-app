CREATE TABLE IF NOT EXISTS "missed_seen" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missed_seen_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "region_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"label" text NOT NULL,
	"voice_otp_usd_micro" integer,
	"voice_minute_usd_micro" integer,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"call_id" text,
	"duration" integer,
	"charge_minor" integer,
	"tts_chars" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_devices" ADD COLUMN IF NOT EXISTS "environment" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "region_rates_region_idx" ON "region_rates" USING btree ("region");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_notifications_rate_idx" ON "voice_notifications" USING btree ("tenant_id","to_number","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_notifications_call_idx" ON "voice_notifications" USING btree ("call_id");
