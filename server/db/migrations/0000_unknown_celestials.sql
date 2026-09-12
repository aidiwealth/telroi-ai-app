CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic', 'deepgram', 'elevenlabs', 'google', 'google-cloud', 'grok');--> statement-breakpoint
CREATE TYPE "public"."ai_tier" AS ENUM('byok', 'managed');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('NGN', 'USD');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('startup', 'growth', 'custom');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('superadmin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('telroi', 'twilio', 'telnyx');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('login');--> statement-breakpoint
CREATE TYPE "public"."van_status" AS ENUM('draft', 'live', 'paused');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_email" text NOT NULL,
	"actor_role" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"action" text,
	"summary" text,
	"status" integer,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_copilot_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_email" text NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"greeting" text,
	"system_prompt" text,
	"stt_conn_id" uuid,
	"llm_conn_id" uuid,
	"tts_conn_id" uuid,
	"fallback" jsonb DEFAULT '{}'::jsonb,
	"language" text DEFAULT 'en-NG' NOT NULL,
	"tier" "ai_tier" DEFAULT 'byok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"api_key_enc" text NOT NULL,
	"key_last4" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'untested' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"call_id" text,
	"managed" boolean DEFAULT false NOT NULL,
	"stt_seconds" integer DEFAULT 0 NOT NULL,
	"llm_input_tokens" integer DEFAULT 0 NOT NULL,
	"llm_output_tokens" integer DEFAULT 0 NOT NULL,
	"tts_chars" integer DEFAULT 0 NOT NULL,
	"cost_nano_usd" bigint DEFAULT 0 NOT NULL,
	"cost_minor_usd" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text DEFAULT 'tlr_live' NOT NULL,
	"last4" text NOT NULL,
	"scopes" jsonb DEFAULT '["*"]'::jsonb,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"group_label" text DEFAULT 'Mobile' NOT NULL,
	"icon_key" text DEFAULT 'apple' NOT NULL,
	"accent" text DEFAULT '#0A0A0B' NOT NULL,
	"version" text,
	"download_url" text,
	"requirement" text,
	"file_size" text,
	"status" text DEFAULT 'available' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"otp_hash" text NOT NULL,
	"purpose" "token_purpose" DEFAULT 'login' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blacklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"telnum" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"callid" text NOT NULL,
	"type" text,
	"direction" text,
	"phone" text,
	"user" text,
	"status" text,
	"carrier" text,
	"handled_by" text,
	"taken_over_by_user_id" uuid,
	"taken_over_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"duration" integer,
	"agent_seconds" integer,
	"wait" integer,
	"rating" integer,
	"recording_url" text,
	"raw" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_uid" text NOT NULL,
	"rating" integer,
	"note" text,
	"rated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"callid" text NOT NULL,
	"telnum" text,
	"direction" text,
	"phone" text,
	"object_key" text,
	"content_type" text,
	"size_bytes" integer,
	"duration_seconds" integer,
	"carrier" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"transcript" text,
	"transcript_status" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"prefix" text NOT NULL,
	"region" text DEFAULT 'NG' NOT NULL,
	"sip_gateway" text NOT NULL,
	"sip_gateway2" text,
	"sip_port" integer DEFAULT 5060 NOT NULL,
	"transport" text DEFAULT 'udp' NOT NULL,
	"sip_domain" text,
	"auth_user" text,
	"auth_pass_enc" text,
	"from_user" text,
	"caller_id" text,
	"codecs" jsonb DEFAULT '["ulaw","alaw"]'::jsonb,
	"webhook_secret_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_name_unique" UNIQUE("name"),
	CONSTRAINT "carriers_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"official_name" text NOT NULL,
	"business_license_key" text,
	"business_license_name" text,
	"business_license_type" text,
	"regulatory_license_key" text,
	"regulatory_license_name" text,
	"regulatory_license_type" text,
	"step" integer DEFAULT 0 NOT NULL,
	"ncc_undertaking_key" text,
	"ncc_undertaking_name" text,
	"ncc_undertaking_type" text,
	"use_case" text,
	"call_audience" text,
	"director_name" text,
	"nin" text,
	"nin_verified_at" timestamp with time zone,
	"nin_reference" text,
	"nin_name" text,
	"nin_attempts" integer DEFAULT 0 NOT NULL,
	"nin_last_attempt_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connect_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"telnum" text,
	"nodes" jsonb DEFAULT '[]'::jsonb,
	"workflows" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_user_id" uuid,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"call_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"company" text,
	"email" text,
	"phone" text,
	"alt_phone" text,
	"country" text,
	"region" text,
	"city" text,
	"timezone" text,
	"status" text DEFAULT 'lead' NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"owner_user_id" uuid,
	"source" text,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"source" text DEFAULT 'CRM' NOT NULL,
	"file_name" text,
	"file_key" text,
	"file_type" text,
	"drive_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "department_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"can_make_calls" boolean DEFAULT true NOT NULL,
	"can_take_calls" boolean DEFAULT true NOT NULL,
	"can_operate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ring_strategy" text DEFAULT 'simultaneous' NOT NULL,
	"ring_timeout" integer DEFAULT 25 NOT NULL,
	"pbx_group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"feature" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"target_url" text NOT NULL,
	"secret_enc" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"credentials_enc" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"mode_embed" boolean DEFAULT true NOT NULL,
	"mode_import" boolean DEFAULT false NOT NULL,
	"last_sync_error" text,
	"last_import_at" timestamp with time zone,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"connected_by_user_id" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_via" text,
	"reminded_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"file_name" text NOT NULL,
	"file_key" text,
	"file_type" text,
	"source_type" text DEFAULT 'upload' NOT NULL,
	"source_url" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"extracted_text" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_minor" integer NOT NULL,
	"balance_after_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"sandbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"telnum" text,
	"inventory_id" uuid,
	"user_id" uuid,
	"user_email" text NOT NULL,
	"user_role" text,
	"declared_categories" text[],
	"ip" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"visitor_name" text,
	"visitor_phone" text,
	"visitor_type" text DEFAULT 'visitor' NOT NULL,
	"external_user_id" text,
	"page_url" text,
	"country" text,
	"region" text,
	"city" text,
	"lat" text,
	"lng" text,
	"status" text DEFAULT 'opened' NOT NULL,
	"outcome" text,
	"routed_to" text,
	"handled_by_user_id" uuid,
	"handled_by_label" text,
	"taken_over_by_user_id" uuid,
	"taken_over_at" timestamp with time zone,
	"contact_id" uuid,
	"csat_score" integer,
	"csat_comment" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"summary" text,
	"level" text DEFAULT 'info' NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"pbx_login" text,
	"dnd" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "number_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telnum" text NOT NULL,
	"region" text NOT NULL,
	"provider" text DEFAULT 'telroi' NOT NULL,
	"provision_status" text DEFAULT 'unprovisioned' NOT NULL,
	"provision_ref" text,
	"monthly_usd_minor_override" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"sold_to_tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "number_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"telnum" text NOT NULL,
	"region" text DEFAULT 'NG' NOT NULL,
	"provider" text DEFAULT 'telroi' NOT NULL,
	"channels" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"department_id" uuid,
	"route_type" text DEFAULT 'person' NOT NULL,
	"route_target" text,
	"route_agent_id" uuid,
	"route_escalate_mode" text DEFAULT 'none' NOT NULL,
	"route_escalate_to" text,
	"route_escalate_after" integer DEFAULT 0,
	"record_calls" boolean DEFAULT false NOT NULL,
	"record_outbound" boolean DEFAULT false NOT NULL,
	"use_categories" text[],
	"provision_state" text DEFAULT 'local' NOT NULL,
	"provision_ref" text,
	"provisioned_at" timestamp with time zone,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_billing_at" timestamp with time zone NOT NULL,
	"last_billed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"token" text,
	"token_enc" text,
	"provider_customer_id" text,
	"billing_email" text,
	"provider_signature" text,
	"reusable" boolean DEFAULT false NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"credited_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_features" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"startup" boolean DEFAULT true NOT NULL,
	"growth" boolean DEFAULT true NOT NULL,
	"custom" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "platform_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"country" text,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_documents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"sandbox_call_cap" integer DEFAULT 20 NOT NULL,
	"trial_ai_allowance_usd_minor" integer DEFAULT 500 NOT NULL,
	"trial_call_max_seconds" integer DEFAULT 300 NOT NULL,
	"sandbox_agent_cap" integer DEFAULT 1 NOT NULL,
	"operator_domain" text,
	"operator_api_key_enc" text,
	"operator_username" text,
	"operator_password_enc" text,
	"operator_dialplan_id" text,
	"operator_route_id" text,
	"client_domain_suffix" text,
	"telroi_pbx_domain" text,
	"telroi_pbx_key_enc" text,
	"twilio_creds_enc" text,
	"telnyx_creds_enc" text,
	"twilio_voice_creds_enc" text,
	"telnyx_voice_creds_enc" text,
	"digidite_voice_creds_enc" text,
	"asterisk_voice_creds_enc" text,
	"sotel_voice_creds_enc" text,
	"ruach_voice_creds_enc" text,
	"outbound_sip_ip" text,
	"payment_mode" text DEFAULT 'test',
	"otp_channel" text DEFAULT 'resend',
	"support_tenant_id" uuid,
	"support_telnum" text,
	"support_numbers_by_region" jsonb DEFAULT '{}'::jsonb,
	"captcha_enabled" boolean DEFAULT false NOT NULL,
	"captcha_provider" text DEFAULT 'turnstile',
	"captcha_site_key" text,
	"sip_proxy_domain" text,
	"twilio_webhook_secret_enc" text,
	"telnyx_webhook_secret_enc" text,
	"pbx_webhook_secret_enc" text,
	"asterisk_webhook_secret_enc" text,
	"sotel_webhook_secret_enc" text,
	"ruach_webhook_secret_enc" text,
	"inbound_webhooks_enabled" jsonb DEFAULT '{}'::jsonb,
	"email_overrides" jsonb DEFAULT '{}'::jsonb,
	"email_social" jsonb DEFAULT '{}'::jsonb,
	"stripe_live_enc" text,
	"stripe_test_enc" text,
	"stripe_webhook_live_enc" text,
	"stripe_webhook_test_enc" text,
	"paystack_live_enc" text,
	"paystack_test_enc" text,
	"monnify_live_enc" text,
	"monnify_test_enc" text,
	"otp_voice_vendor" text DEFAULT 'telroi' NOT NULL,
	"otp_intl_vendor" text,
	"otp_ng_trunk" text DEFAULT 'ruach-endpoint' NOT NULL,
	"otp_ng_caller_id" text,
	"otp_ng_host" text,
	"slack_webhook_enc" text,
	"slack_payments_enc" text,
	"ops_email" text,
	"prembly_creds_enc" text,
	"demo_number_ng" text,
	"demo_number_intl" text,
	"sip_public_host" text,
	"sip_public_ip" text,
	"tts_vendor" text DEFAULT 'telroi' NOT NULL,
	"stt_vendor" text DEFAULT 'telroi' NOT NULL,
	"otp_voice_vendor_creds_enc" text,
	"tts_vendor_creds_enc" text,
	"stt_vendor_creds_enc" text,
	"otp_code_length" integer DEFAULT 6 NOT NULL,
	"otp_ttl_seconds" integer DEFAULT 300 NOT NULL,
	"otp_max_attempts" integer DEFAULT 3 NOT NULL,
	"otp_call_timeout_seconds" integer DEFAULT 45 NOT NULL,
	"otp_repeat_count" integer DEFAULT 2 NOT NULL,
	"otp_rate_max_per_hour" integer DEFAULT 5 NOT NULL,
	"otp_rate_max_per_day" integer DEFAULT 20 NOT NULL,
	"otp_rate_cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"docs_domain" text,
	"status_domain" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"voice_otp_usd_micro" integer DEFAULT 10000 NOT NULL,
	"voice_minute_usd_minor" integer DEFAULT 1 NOT NULL,
	"voice_minute_usd_micro" integer DEFAULT 10200 NOT NULL,
	"channel_monthly_usd_minor" integer DEFAULT 200 NOT NULL,
	"did_monthly_usd_minor" integer DEFAULT 170 NOT NULL,
	"transcription_minute_usd_micro" integer DEFAULT 20000 NOT NULL,
	"recording_days_startup" integer DEFAULT 7 NOT NULL,
	"recording_days_growth" integer DEFAULT 30 NOT NULL,
	"plan_startup_usd_minor" integer DEFAULT 1000 NOT NULL,
	"plan_growth_usd_minor" integer DEFAULT 1500 NOT NULL,
	"ai_daily_cap_usd_minor" integer DEFAULT 500 NOT NULL,
	"min_topup_usd_minor" integer DEFAULT 1000 NOT NULL,
	"min_topup_ngn_minor" integer DEFAULT 1500000 NOT NULL,
	"plan_startup_annual_usd_minor" integer DEFAULT 10000 NOT NULL,
	"plan_growth_annual_usd_minor" integer DEFAULT 15000 NOT NULL,
	"ngn_per_usd" integer DEFAULT 1600 NOT NULL,
	"ai_stt_per_sec_nano" integer DEFAULT 100000 NOT NULL,
	"ai_llm_in_per_tok_nano" integer DEFAULT 800 NOT NULL,
	"ai_llm_out_per_tok_nano" integer DEFAULT 4000 NOT NULL,
	"ai_tts_per_char_nano" integer DEFAULT 15000 NOT NULL,
	"ai_markup_pct" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_overrides" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"voice_minute_usd_minor" integer,
	"voice_minute_usd_micro" integer,
	"voice_otp_usd_micro" integer,
	"channel_monthly_usd_minor" integer,
	"did_monthly_usd_minor" integer,
	"transcription_minute_usd_micro" integer,
	"plan_startup_usd_minor" integer,
	"plan_growth_usd_minor" integer,
	"plan_startup_annual_usd_minor" integer,
	"plan_growth_annual_usd_minor" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provisioning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"resource_ref" text,
	"vendor" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sip_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"label" text,
	"sip_username" text,
	"secret_enc" text,
	"domain" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"leased_session_id" uuid,
	"leased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sip_ip_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ip_address" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"endpoint_id" uuid,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speech_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text,
	"voice" text,
	"format" text,
	"input_chars" integer,
	"result_url" text,
	"transcript" text,
	"duration_ms" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_key" text NOT NULL,
	"ok" boolean NOT NULL,
	"state" text NOT NULL,
	"latency_ms" integer,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_components" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"manual_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "status_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'investigating' NOT NULL,
	"impact" text DEFAULT 'minor' NOT NULL,
	"body" text,
	"affected" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_feature_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"country" text,
	"sector" text,
	"business_phone" text,
	"block_anonymous" boolean DEFAULT false NOT NULL,
	"telroi_domain" text,
	"telroi_api_key_enc" text,
	"provision_state" text DEFAULT 'local' NOT NULL,
	"closed_at" timestamp with time zone,
	"went_live_at" timestamp with time zone,
	"widget_key" text,
	"plan" "plan" DEFAULT 'startup' NOT NULL,
	"plan_selected" boolean DEFAULT false NOT NULL,
	"trial_plan" "plan",
	"trial_ends_at" timestamp with time zone,
	"plan_next_billing_at" timestamp with time zone,
	"billing_interval" text DEFAULT 'monthly' NOT NULL,
	"ai_daily_cap_usd_minor" integer,
	"plan_last_billed_at" timestamp with time zone,
	"trial_days" integer DEFAULT 7 NOT NULL,
	"onboarding_step" integer DEFAULT 0 NOT NULL,
	"payment_provider_override" text,
	"sip_vendor_override" jsonb,
	"sip_device_vendor" text DEFAULT 'telroi',
	"tenant_digidite_sip_enc" text,
	"last_activity_at" timestamp with time zone,
	"followup_48_sent_at" timestamp with time zone,
	"followup_1w_sent_at" timestamp with time zone,
	"email_unsubscribed_at" timestamp with time zone,
	"unsub_token" text,
	"postpaid" boolean DEFAULT false NOT NULL,
	"credit_limit_minor" bigint,
	"billing_day" integer,
	"payment_terms_days" integer,
	"billing_suspended_at" timestamp with time zone,
	"postpaid_since" timestamp with time zone,
	"sandbox_mode" boolean DEFAULT true NOT NULL,
	"sandbox_call_cap" integer,
	"trial_ai_allowance_usd_minor" integer,
	"otp_rate_max_per_hour" integer,
	"otp_rate_max_per_day" integer,
	"otp_rate_cooldown_seconds" integer,
	"trial_call_max_seconds" integer,
	"sandbox_agent_cap" integer,
	"is_internal" boolean DEFAULT false NOT NULL,
	"policy_accepted_at" timestamp with time zone,
	"policy_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"push_token" text NOT NULL,
	"platform" text NOT NULL,
	"model" text,
	"app_version" text,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"admin_email" text,
	"tenant_id" uuid,
	"kind" text DEFAULT 'client' NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"copilot_onboarded" boolean DEFAULT false NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"telnum" text NOT NULL,
	"provider" "provider_kind" DEFAULT 'telroi' NOT NULL,
	"agent_id" uuid,
	"languages" jsonb DEFAULT '["en"]'::jsonb,
	"escalate_mode" text DEFAULT 'none' NOT NULL,
	"escalate_to" text,
	"escalate_after" integer DEFAULT 0,
	"crm_writeback" boolean DEFAULT true NOT NULL,
	"status" "van_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "virtual_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'monnify' NOT NULL,
	"account_reference" text NOT NULL,
	"account_name" text NOT NULL,
	"account_number" text,
	"bank_name" text,
	"bank_code" text,
	"accounts" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"to_number" text NOT NULL,
	"code_hash" text NOT NULL,
	"pending_code" text,
	"code_length" integer NOT NULL,
	"client_supplied" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"provider" text,
	"provider_ref" text,
	"reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"credentials_enc" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"balance_minor" integer DEFAULT 0 NOT NULL,
	"plan" "plan" DEFAULT 'startup' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"response_excerpt" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text,
	"tenant_id" uuid,
	"signature_ok" boolean,
	"outcome" text DEFAULT 'received' NOT NULL,
	"detail" text,
	"body_excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_stt_conn_id_ai_connections_id_fk" FOREIGN KEY ("stt_conn_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_llm_conn_id_ai_connections_id_fk" FOREIGN KEY ("llm_conn_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tts_conn_id_ai_connections_id_fk" FOREIGN KEY ("tts_conn_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blacklist" ADD CONSTRAINT "blacklist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_events" ADD CONSTRAINT "call_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_events" ADD CONSTRAINT "call_events_taken_over_by_user_id_users_id_fk" FOREIGN KEY ("taken_over_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_ratings" ADD CONSTRAINT "call_ratings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_ratings" ADD CONSTRAINT "call_ratings_rated_by_user_id_users_id_fk" FOREIGN KEY ("rated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance" ADD CONSTRAINT "compliance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connect_flows" ADD CONSTRAINT "connect_flows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_notes" ADD CONSTRAINT "crm_contact_notes_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_notes" ADD CONSTRAINT "crm_contact_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contact_notes" ADD CONSTRAINT "crm_contact_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_import_jobs" ADD CONSTRAINT "crm_import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_import_jobs" ADD CONSTRAINT "crm_import_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_members" ADD CONSTRAINT "department_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_settings" ADD CONSTRAINT "feature_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger" ADD CONSTRAINT "ledger_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger" ADD CONSTRAINT "ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_taken_over_by_user_id_users_id_fk" FOREIGN KEY ("taken_over_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "logs" ADD CONSTRAINT "logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "number_inventory" ADD CONSTRAINT "number_inventory_sold_to_tenant_id_tenants_id_fk" FOREIGN KEY ("sold_to_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "number_subscriptions" ADD CONSTRAINT "number_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "number_subscriptions" ADD CONSTRAINT "number_subscriptions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "number_subscriptions" ADD CONSTRAINT "number_subscriptions_route_agent_id_ai_agents_id_fk" FOREIGN KEY ("route_agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_overrides" ADD CONSTRAINT "pricing_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provisioning_events" ADD CONSTRAINT "provisioning_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sip_endpoints" ADD CONSTRAINT "sip_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sip_ip_requests" ADD CONSTRAINT "sip_ip_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "speech_jobs" ADD CONSTRAINT "speech_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vans" ADD CONSTRAINT "vans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vans" ADD CONSTRAINT "vans_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_otps" ADD CONSTRAINT "voice_otps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_providers" ADD CONSTRAINT "voice_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_actor_idx" ON "admin_audit_log" USING btree ("actor_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_copilot_conv_email_idx" ON "admin_copilot_conversations" USING btree ("admin_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agents_tenant_idx" ON "ai_agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conn_tenant_idx" ON "ai_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_tenant_idx" ON "ai_usage" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_call_idx" ON "ai_usage" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_releases_platform_uidx" ON "app_releases" USING btree ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_tokens_email_idx" ON "auth_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blacklist_tenant_idx" ON "blacklist" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blacklist_tenant_telnum_idx" ON "blacklist" USING btree ("tenant_id","telnum");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_tenant_idx" ON "call_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_callid_idx" ON "call_events" USING btree ("callid");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "call_events_tenant_callid_uidx" ON "call_events" USING btree ("tenant_id","callid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_events_page_idx" ON "call_events" USING btree ("started_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "call_ratings_tenant_call_uidx" ON "call_ratings" USING btree ("tenant_id","call_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_recordings_tenant_idx" ON "call_recordings" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_recordings_callid_idx" ON "call_recordings" USING btree ("callid");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_tenant_idx" ON "compliance" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connect_flows_tenant_idx" ON "connect_flows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copilot_conv_tenant_user_idx" ON "copilot_conversations" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_notes_contact_idx" ON "crm_contact_notes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_contacts_tenant_idx" ON "crm_contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_contacts_phone_idx" ON "crm_contacts" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crm_contacts_tenant_phone_uidx" ON "crm_contacts" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_import_jobs_tenant_idx" ON "crm_import_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dept_members_dept_user_idx" ON "department_members" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dept_members_tenant_idx" ON "department_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dept_members_user_idx" ON "department_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "departments_tenant_idx" ON "departments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_settings_scope_idx" ON "feature_settings" USING btree ("tenant_id","feature");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_events_tenant_idx" ON "integration_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_events_event_idx" ON "integration_events" USING btree ("tenant_id","event");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_tenant_provider_uidx" ON "integrations" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_tenant_idx" ON "knowledge_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_documents_agent_idx" ON "knowledge_documents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_wallet_idx" ON "ledger" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_ref_idx" ON "ledger" USING btree ("reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_call_sessions_tenant_idx" ON "live_call_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_call_sessions_started_idx" ON "live_call_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_kind_idx" ON "logs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_tenant_idx" ON "logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_created_idx" ON "logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_expires_idx" ON "logs" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_user_tenant_idx" ON "memberships" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "number_inventory_telnum_idx" ON "number_inventory" USING btree ("telnum");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "number_inventory_status_idx" ON "number_inventory" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "number_subs_tenant_idx" ON "number_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "number_subs_telnum_idx" ON "number_subscriptions" USING btree ("telnum");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_tenant_idx" ON "payment_methods" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_ref_idx" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admins_email_idx" ON "platform_admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provisioning_events_tenant_idx" ON "provisioning_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sip_endpoints_tenant_idx" ON "sip_endpoints" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sip_endpoints_lease_idx" ON "sip_endpoints" USING btree ("tenant_id","kind","leased_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "speech_jobs_tenant_idx" ON "speech_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_checks_comp_idx" ON "status_checks" USING btree ("component_key","checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_incidents_started_idx" ON "status_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_feature_idx" ON "tenant_feature_overrides" USING btree ("tenant_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_devices_token_idx" ON "user_devices" USING btree ("push_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_devices_user_idx" ON "user_devices" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vans_tenant_idx" ON "vans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vans_telnum_idx" ON "vans" USING btree ("telnum");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "virtual_accounts_tenant_idx" ON "virtual_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "virtual_accounts_ref_idx" ON "virtual_accounts" USING btree ("account_reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_otps_tenant_idx" ON "voice_otps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_otps_to_idx" ON "voice_otps" USING btree ("tenant_id","to_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_otps_status_idx" ON "voice_otps" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vp_tenant_idx" ON "voice_providers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_tenant_idx" ON "wallets" USING btree ("tenant_id");