// server/db/schema.ts
// Drizzle ORM schema for the Telroi dashboard (PostgreSQL).
import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, index, uniqueIndex
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'admin', 'member']);export const platformRoleEnum = pgEnum('platform_role', ['superadmin', 'staff']);
export const providerKindEnum = pgEnum('provider_kind', ['telroi', 'twilio', 'telnyx']);
export const aiProviderEnum = pgEnum('ai_provider', ['openai', 'anthropic', 'deepgram', 'elevenlabs', 'vapi', 'google']);
export const tokenPurposeEnum = pgEnum('token_purpose', ['login']);
export const vanStatusEnum = pgEnum('van_status', ['draft', 'live', 'paused']);
export const currencyEnum = pgEnum('currency', ['NGN', 'USD']);
export const ledgerKindEnum = pgEnum('ledger_kind', ['credit', 'debit']);
export const aiTierEnum = pgEnum('ai_tier', ['byok', 'managed']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'succeeded', 'failed']);
export const planEnum = pgEnum('plan', ['startup', 'growth', 'custom']);

/* ---------- Platform (operator/boss level) ----------
   Single-row config holding the Digitide Operator API credentials. The boss
   key is the master credential over the entire PBX estate, so it lives once,
   at the platform level, encrypted — never duplicated per tenant. */
export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey().default('singleton'), // enforce one row
  operatorDomain: text('operator_domain'),           // the single Digidite account domain (provisioning + NG carrier)
  operatorApiKeyEnc: text('operator_api_key_enc'),   // AES-256-GCM
  operatorUsername: text('operator_username'),        // Digidite operator login (Basic auth)
  operatorPasswordEnc: text('operator_password_enc'), // AES-256-GCM (Basic auth)
  operatorDialplanId: text('operator_dialplan_id'),   // Digidite dialplan UUID (from portal)
  operatorRouteId: text('operator_route_id'),         // Digidite route UUID (from portal)
  clientDomainSuffix: text('client_domain_suffix').default('digitaltide.io'),
  // ── Master carrier credentials (platform-level, held by Telroi, never per-tenant) ──
  // Digidite is the default NG carrier and is the SAME account as the operator
  // credential above (merged). These optional fields let an operator override the
  // Digidite carrier route with a separate account if ever needed.
  telroiPbxDomain: text('telroi_pbx_domain'),         // optional override; defaults to operatorDomain
  telroiPbxKeyEnc: text('telroi_pbx_key_enc'),        // AES-256-GCM
  twilioCredsEnc: text('twilio_creds_enc'),           // {accountSid, authToken}
  telnyxCredsEnc: text('telnyx_creds_enc'),           // {apiKey, connectionId}
  // ── Browser-voice (WebRTC) credentials, AES-256-GCM. These power IN-BROWSER
  // calling (mic + ringing + audio) for the dialer and the Live Call widget.
  // Twilio Voice SDK needs an API Key/Secret + a TwiML App SID + outgoing caller id.
  twilioVoiceCredsEnc: text('twilio_voice_creds_enc'),   // {apiKeySid, apiKeySecret, twimlAppSid, callerId}
  // Telnyx WebRTC needs a SIP connection (credential) login/password + connection id.
  telnyxVoiceCredsEnc: text('telnyx_voice_creds_enc'),   // {sipUsername, sipPassword, connectionId, callerId}
  // Digidite WebRTC/SIP gateway for the NG route.
  digiditeVoiceCredsEnc: text('digidite_voice_creds_enc'), // {wsServer, sipDomain, sipUsername, sipPassword, callerId}
  // Sotel direct SIP trunk (Nigeria only). IP-authenticated trunk: signaling to
  // a fixed gateway IP:port over UDP/TCP/TLS, with a set of assigned DIDs. Used
  // when Telroi connects to Sotel directly instead of via a hosted platform.
  // {sipGateway, sipPort, transport, sipDomain, authUser, authPass, callerId, dids[]}
  // Core Asterisk integration (GLOBAL, all countries). Self-hosted on a separate
  // server, IP-authenticated. Has BOTH a SIP trunk and an AMI/ARI REST API.
  // {sipGateway, sipPort, transport, sipDomain, authUser, authPass, callerId, dids[],
  //  apiBaseUrl, apiUsername, apiPassword, ariAppName}
  asteriskVoiceCredsEnc: text('asterisk_voice_creds_enc'),
  sotelVoiceCredsEnc: text('sotel_voice_creds_enc'),     // {sipGateway, sipPort, transport, sipDomain, callerId, dids[]}
  ruachVoiceCredsEnc: text('ruach_voice_creds_enc'),     // {sipAccount, sipPassword, sipDomain, callerId, dids[]}
  // Ruach SIP trunk (Nigeria only). Logs in with a SIP account number + password
  // Our outbound/signaling IP that SIP vendors must whitelist. Sourced from env
  // OUTBOUND_SIP_IP by default; this column lets ops override without a redeploy.
  outboundSipIp: text('outbound_sip_ip'),
  // ── Payment provider keys (live + test/sandbox), AES-256-GCM. Editable from
  // the admin dashboard. paymentMode selects which set is active platform-wide. ──
  paymentMode: text('payment_mode').default('test'),  // test | live
  // OTP delivery channel, operator-controlled. 'resend' (default) sends OTP
  // codes through the normal email sender; 'termii' routes OTP codes through
  // Termii's email-token API instead. All non-OTP email always uses the base
  // sender (Resend) regardless of this setting.
  otpChannel: text('otp_channel').default('resend'),  // resend | termii
  // Telroi Support workspace: a dedicated tenant the support/CS team calls FROM.
  // Reuses the normal tenant calling/AI/wallet/history machinery. supportTelnum
  // is the caller-ID/line support dials out on.
  supportTenantId: uuid('support_tenant_id'),
  supportTelnum: text('support_telnum'),
  // Default support caller-ID number per region, selected from provisioned
  // numbers. The support Live Call widget, admin VANs, and admin dialer all use
  // these — keyed by the caller's detected region. { NG: '+234…', INTL: '+1…' }
  supportNumbersByRegion: jsonb('support_numbers_by_region').$type<{ NG?: string; INTL?: string }>().default({}),
  // Login bot-gate (CAPTCHA). Operator-controlled enable + provider + PUBLIC
  // site key. The SECRET key stays in env (CAPTCHA_SECRET) and is never stored
  // in the DB — same handling as other server credentials.
  captchaEnabled: boolean('captcha_enabled').notNull().default(false),
  captchaProvider: text('captcha_provider').default('turnstile'), // turnstile | recaptcha
  captchaSiteKey: text('captcha_site_key'),
  // Optional Telroi-branded SIP proxy/CNAME (e.g. sip.telroi.ai). When set, the
  // client SIP page shows THIS host instead of the carrier's real hostname, so
  // the vendor stays hidden. Requires a real proxy/SBC or CNAME in front.
  sipProxyDomain: text('sip_proxy_domain'),
  // Inbound webhook config. We verify carrier callbacks with these secrets, and
  // toggle which carriers' inbound logging is active. The webhook URL itself is
  // Telroi's endpoint (shown in admin to paste into the carrier; also
  // auto-registered on provision where the carrier API supports it).
  twilioWebhookSecretEnc: text('twilio_webhook_secret_enc'), // Twilio auth token is used to sign; stored if separate
  telnyxWebhookSecretEnc: text('telnyx_webhook_secret_enc'), // Telnyx public key / signing secret
  pbxWebhookSecretEnc: text('pbx_webhook_secret_enc'),       // shared secret for PBX inbound posts
  asteriskWebhookSecretEnc: text('asterisk_webhook_secret_enc'), // shared secret for Asterisk inbound posts
  sotelWebhookSecretEnc: text('sotel_webhook_secret_enc'),   // shared secret for Sotel inbound posts
  ruachWebhookSecretEnc: text('ruach_webhook_secret_enc'),   // shared secret for Ruach inbound posts
  inboundWebhooksEnabled: jsonb('inbound_webhooks_enabled').$type<{ twilio?: boolean; telnyx?: boolean; pbx?: boolean; asterisk?: boolean }>().default({}),
  // Admin-editable email content. A JSON map of templateKey -> overrides
  // ({ subject?, heading?, intro?, body? }) layered over the built-in designs,
  // so operators can tweak copy without code. Social links power the email
  // footer icons.
  emailOverrides: jsonb('email_overrides').$type<Record<string, { subject?: string; heading?: string; intro?: string; body?: string }>>().default({}),
  emailSocial: jsonb('email_social').$type<{ x?: string; linkedin?: string; instagram?: string; facebook?: string }>().default({}),
  stripeLiveEnc: text('stripe_live_enc'),
  stripeTestEnc: text('stripe_test_enc'),
  paystackLiveEnc: text('paystack_live_enc'),
  paystackTestEnc: text('paystack_test_enc'),
  monnifyLiveEnc: text('monnify_live_enc'),            // {apiKey, secretKey, contractCode}
  monnifyTestEnc: text('monnify_test_enc'),
  // ── Voice OTP + Speech APIs (public API features) ──────────────────────────
  // Which vendor powers each speech capability. 'telroi' = use Telroi's own
  // voice infra (the configured carrier gateway); other values name an external
  // integration whose creds live in the *VendorCredsEnc fields below. Operators
  // pick these in admin Settings; the adapter layer routes accordingly.
  otpVoiceVendor: text('otp_voice_vendor').notNull().default('telroi'),   // telroi | twilio | telnyx | vonage | custom
  ttsVendor: text('tts_vendor').notNull().default('telroi'),              // telroi | elevenlabs | openai | google | azure | custom
  sttVendor: text('stt_vendor').notNull().default('telroi'),             // telroi | deepgram | openai | google | azure | custom
  otpVoiceVendorCredsEnc: text('otp_voice_vendor_creds_enc'),            // AES-256-GCM vendor creds blob
  ttsVendorCredsEnc: text('tts_vendor_creds_enc'),
  sttVendorCredsEnc: text('stt_vendor_creds_enc'),
  // Voice-OTP policy, operator-controlled. These bound what clients can request
  // via the API (a client may request stricter, never looser than these).
  otpCodeLength: integer('otp_code_length').notNull().default(6),         // digits in the code
  otpTtlSeconds: integer('otp_ttl_seconds').notNull().default(300),       // how long a code stays valid
  otpMaxAttempts: integer('otp_max_attempts').notNull().default(3),       // verify attempts before lockout
  otpCallTimeoutSeconds: integer('otp_call_timeout_seconds').notNull().default(45), // ring/answer timeout
  otpRepeatCount: integer('otp_repeat_count').notNull().default(2),       // times the code is read aloud
  otpRateMaxPerHour: integer('otp_rate_max_per_hour').notNull().default(5),   // per destination number
  otpRateMaxPerDay: integer('otp_rate_max_per_day').notNull().default(20),    // per destination number
  otpRateCooldownSeconds: integer('otp_rate_cooldown_seconds').notNull().default(60), // min gap between sends
  // Optional custom subdomain that serves the public API docs (e.g.
  // developers.telroi.ai). When set, that host's root path serves the docs.
  // The docs always remain available at the default /api/docs path too.
  docsDomain: text('docs_domain'),
  // Optional custom subdomain that serves the public status page (e.g.
  // status.telroi.ai). Default path /status always works.
  statusDomain: text('status_domain'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/* Platform admins — the separate admin.telroi.ai login. Distinct from tenant
   memberships; these people operate the whole system. */
export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  role: platformRoleEnum('role').notNull().default('staff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  emailIdx: uniqueIndex('platform_admins_email_idx').on(t.email)
}));

/* ---------- Tenants ---------- */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  country: text('country'),   // ISO-ish country code/name collected at signup
  sector: text('sector'),     // business sector/industry collected at signup
  businessPhone: text('business_phone'), // primary contact number for the workspace (collected at onboarding)
  // When true, inbound calls with no caller-id (anonymous/withheld) are rejected.
  blockAnonymous: boolean('block_anonymous').notNull().default(false),
  telroiDomain: text('telroi_domain'),
  telroiApiKeyEnc: text('telroi_api_key_enc'),
  // Local-first provisioning lifecycle. Tenants start 'local' (everything in our
  // DB, zero vendor cost). At go-live we provision the country's vendor: Nigeria
  // -> Digidite (deferred entirely), elsewhere -> carrier (Twilio/Telnyx, which
  // admin may provision early). 'local' | 'provisioning' | 'provisioned'.
  provisionState: text('provision_state').notNull().default('local'),
  wentLiveAt: timestamp('went_live_at', { withTimezone: true }),
  // Public key for the Live Call embed widget (safe to expose in client-side JS;
  // scopes the widget to this tenant, read-only/config + session-create only).
  widgetKey: text('widget_key'),
  // Plan & trial state. plan is the effective tier; trialPlan + trialEndsAt drive
  // the 7/14/30-day Growth trial that reverts to Startup when it lapses.
  plan: planEnum('plan').notNull().default('startup'),
  planSelected: boolean('plan_selected').notNull().default(false), // gate dashboard until chosen
  trialPlan: planEnum('trial_plan'),                 // plan being trialed (e.g. growth)
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  // Monthly plan-fee billing anchor (separate from per-number billing). Set when
  // the workspace goes live; the billing cron charges the plan fee when due.
  planNextBillingAt: timestamp('plan_next_billing_at', { withTimezone: true }),
  planLastBilledAt: timestamp('plan_last_billed_at', { withTimezone: true }),
  trialDays: integer('trial_days').notNull().default(7), // admin-configurable length
  onboardingStep: integer('onboarding_step').notNull().default(0), // 0..5, 5 = done
  // Optional per-client payment gateway override. null = use the platform
  // default (currency-based: Paystack/Monnify for NGN, Stripe for USD).
  paymentProviderOverride: text('payment_provider_override'), // stripe | paystack | monnify | null
  // Admin override for which SIP vendors this client may use. null = derive from
  // region automatically; otherwise a JSON array like ["twilio","telnyx"].
  sipVendorOverride: jsonb('sip_vendor_override').$type<string[] | null>(),
  // Per-client dedicated-SIP vendor: which carrier issues this client's own SIP
  // device credentials (telroi/twilio/telnyx). Separate from sipVendorOverride
  // (the calling/routing allow-list). null = no BYOD SIP for this client.
  sipDeviceVendor: text('sip_device_vendor'),
  // Per-client Digidite SIP account (set manually from the Digidite portal).
  // Encrypted JSON: {host, authId, password}. Client-specific.
  tenantDigiditeSipEnc: text('tenant_digidite_sip_enc'),
  // Inactivity follow-up tracking: timestamps of the nudge emails already sent,
  // so the cron never double-sends. lastActivityAt is bumped on any real system
  // action (top-up, number, VAN, etc.). emailUnsubscribedAt opts the workspace
  // owner out of non-essential (marketing/nudge) emails.
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  followup48SentAt: timestamp('followup_48_sent_at', { withTimezone: true }),
  followup1wSentAt: timestamp('followup_1w_sent_at', { withTimezone: true }),
  emailUnsubscribedAt: timestamp('email_unsubscribed_at', { withTimezone: true }),
  unsubToken: text('unsub_token'),
  // Per-workspace sandbox switch. When true, money + carrier/PBX actions are
  // simulated (no real charges, no external calls) so the client can safely
  // explore. Server-enforced — the dashboard toggle writes here.
  sandboxMode: boolean('sandbox_mode').notNull().default(true),
  // Internal Telroi workspaces (e.g. the support/CS calling workspace) are NOT
  // customers — excluded from the admin client list, counts and plan filters.
  isInternal: boolean('is_internal').notNull().default(false),
  // Policy acceptance captured at signup (audit trail).
  policyAcceptedAt: timestamp('policy_accepted_at', { withTimezone: true }),
  policyVersion: text('policy_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  slugIdx: uniqueIndex('tenants_slug_idx').on(t.slug)
}));

/* ---------- Users ---------- */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp('last_login', { withTimezone: true })
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email)
}));

/* ---------- Memberships (user <-> tenant) ---------- */
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('member'),
  // Explicit link to this person's PBX agent extension (their login on Digidite).
  // Set when an extension is created for them, so the People page joins by a
  // stored fact rather than guessing from email — secure + reliable.
  pbxLogin: text('pbx_login'),
  // Per-membership Do Not Disturb: when true, this agent is not rung on inbound.
  dnd: boolean('dnd').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  uniq: uniqueIndex('memberships_user_tenant_idx').on(t.userId, t.tenantId)
}));

/* ---------- Departments / Teams ----------
   Departments (a.k.a. teams) are real entities within a workspace. They own
   numbers and group members. Call capabilities for 'member'-role users are
   granted per-department; owners/admins implicitly have all capabilities. */
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  // Call-routing behaviour (folds in the old "ring group" concept): how inbound
  // calls to this team's numbers are distributed across its members.
  ringStrategy: text('ring_strategy').notNull().default('simultaneous'), // simultaneous | round_robin | linear
  ringTimeout: integer('ring_timeout').notNull().default(25), // seconds before overflow
  // The real PBX ring-group id this team maps to (set when pushed to Digidite).
  pbxGroupId: text('pbx_group_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('departments_tenant_idx').on(t.tenantId)
}));

// A user's membership in a department, with their per-department call caps.
export const departmentMembers = pgTable('department_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  canMakeCalls: boolean('can_make_calls').notNull().default(true),
  canTakeCalls: boolean('can_take_calls').notNull().default(true),
  canOperate: boolean('can_operate').notNull().default(false), // manage settings/numbers in dept
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  uniq: uniqueIndex('dept_members_dept_user_idx').on(t.departmentId, t.userId),
  tenantIdx: index('dept_members_tenant_idx').on(t.tenantId),
  userIdx: index('dept_members_user_idx').on(t.userId)
}));
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),   // hash of magic-link token
  otpHash: text('otp_hash').notNull(),        // hash of 6-digit code
  purpose: tokenPurposeEnum('purpose').notNull().default('login'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  emailIdx: index('auth_tokens_email_idx').on(t.email)
}));

/* ---------- AI connections (bring-your-own-key) ---------- */
export const aiConnections = pgTable('ai_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: aiProviderEnum('provider').notNull(),
  apiKeyEnc: text('api_key_enc').notNull(),   // AES-256-GCM, never returned to client
  keyLast4: text('key_last4').notNull(),
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('untested'), // untested | ok | failed
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('ai_conn_tenant_idx').on(t.tenantId)
}));

/* ---------- AI agents (voice agent configs) ---------- */
export const aiAgents = pgTable('ai_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  greeting: text('greeting'),
  systemPrompt: text('system_prompt'),
  sttConnId: uuid('stt_conn_id').references(() => aiConnections.id, { onDelete: 'set null' }),
  llmConnId: uuid('llm_conn_id').references(() => aiConnections.id, { onDelete: 'set null' }),
  ttsConnId: uuid('tts_conn_id').references(() => aiConnections.id, { onDelete: 'set null' }),
  fallback: jsonb('fallback').$type<Record<string, unknown>>().default({}), // e.g. transfer-to-human
  tier: aiTierEnum('tier').notNull().default('byok'), // byok = client keys; managed = Telroi keys (billed)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('ai_agents_tenant_idx').on(t.tenantId)
}));

/* ---------- VANs (Virtual AI Numbers) ----------
   The flagship product: a phone number bound to an AI agent + routing +
   human-escalation policy. A VAN ties together a telnum (on Telroi/Twilio/
   Telnyx), an aiAgent config, and an escalation target. */
export const vans = pgTable('vans', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  telnum: text('telnum').notNull(),                 // the business number
  provider: providerKindEnum('provider').notNull().default('telroi'), // who owns the number
  agentId: uuid('agent_id').references(() => aiAgents.id, { onDelete: 'set null' }),
  languages: jsonb('languages').$type<string[]>().default(['en']),
  escalateTo: text('escalate_to'),                  // extension / group / phone for human handoff
  escalateAfter: integer('escalate_after').default(0), // seconds before handoff (0 = on intent)
  crmWriteback: boolean('crm_writeback').notNull().default(true),
  status: vanStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('vans_tenant_idx').on(t.tenantId),
  telnumIdx: index('vans_telnum_idx').on(t.telnum)
}));

/* ---------- Connect flows (IVR / routing / workflows) ----------
   A Connect flow is a visual call-handling definition bound to a number:
   an ordered set of nodes (greeting, menu/IVR, route-to-user/group/VAN,
   voicemail, hangup) plus workflow actions (CRM write, webhook) that fire on
   call events. Published flows write their routing to the PBX. */
export const connectFlows = pgTable('connect_flows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  telnum: text('telnum'),                            // number this flow answers (nullable until bound)
  nodes: jsonb('nodes').$type<ConnectNode[]>().default([]),
  workflows: jsonb('workflows').$type<ConnectWorkflow[]>().default([]),
  status: text('status').notNull().default('draft'), // draft | published
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('connect_flows_tenant_idx').on(t.tenantId)
}));

/* ---------- Voice providers (carriers) ---------- */
export const voiceProviders = pgTable('voice_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: providerKindEnum('kind').notNull(),
  credentialsEnc: text('credentials_enc'),   // AES-256-GCM JSON blob
  isDefault: boolean('is_default').notNull().default(false),
  status: text('status').notNull().default('untested'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('vp_tenant_idx').on(t.tenantId)
}));

/* ---------- Call events (fed by Telroi -> CRM webhook) ---------- */
export const callEvents = pgTable('call_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  callid: text('callid').notNull(),
  type: text('type'),         // event type or call type
  direction: text('direction'), // in | out
  phone: text('phone'),
  user: text('user'),
  status: text('status'),
  carrier: text('carrier'),   // twilio | telnyx | telroi
  // Human takeover of an AI/VAN call (handoff from the AI agent to a person).
  handledBy: text('handled_by'),                 // 'ai' | 'human' — who is on the call now
  takenOverByUserId: uuid('taken_over_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  takenOverAt: timestamp('taken_over_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  duration: integer('duration'),
  wait: integer('wait'),
  rating: integer('rating'),
  recordingUrl: text('recording_url'),
  raw: jsonb('raw').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('call_events_tenant_idx').on(t.tenantId),
  callIdx: index('call_events_callid_idx').on(t.callid),
  // Unique per tenant+carrier-call-id so webhook events upsert (status updates)
  // instead of duplicating as a call progresses ringing -> answered -> done.
  uniqCall: uniqueIndex('call_events_tenant_callid_uidx').on(t.tenantId, t.callid),
  // Keyset pagination index: newest-first by (startedAt, id).
  pageIdx: index('call_events_page_idx').on(t.startedAt, t.id)
}));

// User-set call ratings + notes, keyed by the PBX call uid. The PBX history is
// read-only for these, so we own them here. One row per (tenant, call).
export const callRatings = pgTable('call_ratings', {  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  callUid: text('call_uid').notNull(),
  rating: integer('rating'),          // 1..5, nullable to allow clearing
  note: text('note'),
  ratedByUserId: uuid('rated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  uniqCall: uniqueIndex('call_ratings_tenant_call_uidx').on(t.tenantId, t.callUid)
}));

// Provisioning audit: every time a resource is pushed to a vendor (or fails),// we record it — so finance/ops can see exactly when vendor billing began for a
// tenant/number/seat and on which vendor (digidite/twilio/telnyx).
export const provisioningEvents = pgTable('provisioning_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),     // tenant_account | team | seat | number
  resourceRef: text('resource_ref'),         // local id or telnum
  vendor: text('vendor').notNull(),          // digidite | twilio | telnyx
  status: text('status').notNull(),          // provisioned | failed | skipped
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('provisioning_events_tenant_idx').on(t.tenantId)
}));

/* ---------- Telroi One: CRM ----------
   Extended contact records for the paid suite. Deliberately does NOT duplicate
   the call log (callEvents) or people (memberships) — a contact is an EXTERNAL
   customer/lead, enriched with details a voice CRM needs, auto-linked to inbound
   web calls and call history by phone number. */
export const crmContacts = pgTable('crm_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name'),
  company: text('company'),
  email: text('email'),
  phone: text('phone'),                 // primary number (E.164) — links to call history
  altPhone: text('alt_phone'),
  // Location
  country: text('country'),
  region: text('region'),               // state/province
  city: text('city'),
  timezone: text('timezone'),
  // CRM fields a voice CRM needs
  status: text('status').notNull().default('lead'), // lead | active | customer | churned
  tags: jsonb('tags').$type<string[]>().default([]),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  source: text('source'),               // web_call | manual | import | inbound
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('crm_contacts_tenant_idx').on(t.tenantId),
  phoneIdx: index('crm_contacts_phone_idx').on(t.tenantId, t.phone),
  uniqPhone: uniqueIndex('crm_contacts_tenant_phone_uidx').on(t.tenantId, t.phone)
}));

// Notes / call reports logged against a contact.
export const crmContactNotes = pgTable('crm_contact_notes', {  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull().references(() => crmContacts.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull().default('note'), // note | call_report
  body: text('body').notNull(),
  callUid: text('call_uid'),            // optional link to a specific call
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  contactIdx: index('crm_notes_contact_idx').on(t.contactId)
}));

// Bulk contact import jobs (up to 100k rows). The file is uploaded directly to
// R2 by the browser; the server parses it from R2 in batches in the background
// and updates progress here so the client can show a live notice.
export const crmImportJobs = pgTable('crm_import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('CRM'),  // CRM | API | SIP | import — categorizes the contacts created
  fileName: text('file_name'),
  fileKey: text('file_key'),            // R2 object key (or local path)
  fileType: text('file_type'),          // csv | xlsx
  driveUrl: text('drive_url'),          // when imported from a Google Drive link
  status: text('status').notNull().default('pending'), // pending | processing | done | failed
  total: integer('total').notNull().default(0),
  processed: integer('processed').notNull().default(0),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true })
}, (t) => ({
  tenantIdx: index('crm_import_jobs_tenant_idx').on(t.tenantId)
}));

// Third-party integration connections (Zapier, Pipedrive, HubSpot). One row per// tenant+provider once connected. Credentials/tokens are encrypted at rest.
export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),       // zapier | pipedrive | hubspot | zoho
  status: text('status').notNull().default('connected'), // connected | error | disconnected
  credentialsEnc: text('credentials_enc'),     // encrypted token/api-key blob
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  // Direction(s) the client wants: 'embed' = use Telroi inside the CRM (click-to-call,
  // call logging onto CRM records); 'import' = pull CRM contacts into Telroi + sync
  // call activity out. A connection can do both.
  modeEmbed: boolean('mode_embed').notNull().default(true),
  modeImport: boolean('mode_import').notNull().default(false),
  // Live sync health.
  lastSyncError: text('last_sync_error'),
  lastImportAt: timestamp('last_import_at', { withTimezone: true }),
  importedCount: integer('imported_count').notNull().default(0),
  connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true })
}, (t) => ({
  uniq: uniqueIndex('integrations_tenant_provider_uidx').on(t.tenantId, t.provider)
}));

// Outbound event subscriptions (Zapier-style). When a Telroi event fires
// (call.completed, call.missed, contact.created, voicemail.received, etc.) we
// POST the payload to each subscribed target URL — this is what powers Zapier
// triggers and generic webhooks.
export const integrationEvents = pgTable('integration_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),       // zapier | (generic) webhook
  event: text('event').notNull(),             // call.completed | call.missed | contact.created | ...
  targetUrl: text('target_url').notNull(),     // where to POST (e.g. Zapier hook URL)
  secretEnc: text('secret_enc'),               // optional signing secret
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true })
}, (t) => ({
  byTenant: index('integration_events_tenant_idx').on(t.tenantId),
  byEvent: index('integration_events_event_idx').on(t.tenantId, t.event)
}));

// Native-app download catalog. ONE row per platform (ios, android, mac, windows,
// linux, …). Platform-agnostic by design: adding a new platform is a row, not a
// code change. Managed by operators; rendered by the client Apps tab. This is
// the distribution surface — it points at where each build is hosted (App Store,
// Play Store, a release bucket), it is not the native binary itself.
export const appReleases = pgTable('app_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  platform: text('platform').notNull(),        // ios | android | mac | windows | linux | chrome
  name: text('name').notNull(),                // "Telroi for iOS"
  description: text('description'),            // short blurb
  groupLabel: text('group_label').notNull().default('Mobile'), // Mobile | Desktop | Browser — for the filter chips
  iconKey: text('icon_key').notNull().default('apple'),        // which built-in glyph: apple|android|windows|linux|browser
  accent: text('accent').notNull().default('#0A0A0B'),         // icon tile colour
  version: text('version'),                    // "2.3.1"
  downloadUrl: text('download_url'),           // store / direct link
  requirement: text('requirement'),            // "iOS 15+"
  fileSize: text('file_size'),                 // "48 MB"
  status: text('status').notNull().default('available'), // available | coming_soon | hidden
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  byPlatform: uniqueIndex('app_releases_platform_uidx').on(t.platform)
}));

/* ---------- Status page ----------
   Components are PREDETERMINED in code (server/utils/status-registry.ts) — admin
   cannot invent or rename them. A scheduled probe records one row per check in
   status_checks; the component's live status + 90-day uptime are COMPUTED from
   that history, never typed. This table holds ONLY the admin-editable bits
   (description, sort order, optional manual override) keyed by the registry key.
   Title and uptime are derived, not stored here. */
export const statusComponents = pgTable('status_components', {
  key: text('key').primaryKey(),                   // registry key, e.g. 'voice_otp' (predetermined)
  description: text('description'),               // admin-editable blurb
  sortOrder: integer('sort_order').notNull().default(0), // admin-editable ordering
  manualStatus: text('manual_status'),             // optional admin override (e.g. force 'maintenance'); null = use probe
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// One row per automated health check. Status + uptime derive from these.
export const statusChecks = pgTable('status_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  componentKey: text('component_key').notNull(),   // registry key
  ok: boolean('ok').notNull(),                     // did the probe pass?
  state: text('state').notNull(),                  // operational | degraded | major_outage | unknown
  latencyMs: integer('latency_ms'),
  detail: text('detail'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  byComp: index('status_checks_comp_idx').on(t.componentKey, t.checkedAt)
}));

export const statusIncidents = pgTable('status_incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  status: text('status').notNull().default('investigating'), // investigating | identified | monitoring | resolved
  impact: text('impact').notNull().default('minor'),         // none | minor | major | critical | maintenance
  body: text('body'),                              // latest update text
  affected: jsonb('affected').$type<string[]>().default([]), // component keys affected
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({ byStarted: index('status_incidents_started_idx').on(t.startedAt) }));

// Settings for Telroi One features (crm, live_call, apps), at two scopes:
//   - platform default: tenantId IS NULL  (admin-set defaults for everyone)
//   - per-tenant:        tenantId = <id>  (a client's own edited settings)
// `locks` lists setting keys the admin has locked so clients can't change them.
// Effective settings = platform default <- tenant overrides, with locked keys
// always taken from the platform default and shown read-only to the client.
export const featureSettings = pgTable('feature_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }), // null = platform default
  feature: text('feature').notNull(),                 // crm | live_call | apps
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  locks: jsonb('locks').$type<string[]>().notNull().default([]), // admin-locked setting keys (platform rows only)
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  uniq: uniqueIndex('feature_settings_scope_idx').on(t.tenantId, t.feature)
}));

// Live Call widget sessions. Each visitor who opens the widget and submits the
// name+mobile form starts a session; it's logged here, routed to the CRM as a
// lead, and tracks the call outcome + CSAT. visitorType distinguishes a public
// landing-page visitor from a logged-in user of the client's own product.
export const liveCallSessions = pgTable('live_call_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  visitorName: text('visitor_name'),
  visitorPhone: text('visitor_phone'),
  visitorType: text('visitor_type').notNull().default('visitor'), // visitor (landing) | user (logged-in)
  externalUserId: text('external_user_id'),   // the client's own user id, when logged in
  pageUrl: text('page_url'),
  // Location (from IP at session start; coarse)
  country: text('country'), region: text('region'), city: text('city'),
  lat: text('lat'), lng: text('lng'),
  status: text('status').notNull().default('opened'), // opened | calling | connected | ended | missed
  outcome: text('outcome'),                    // answered | missed | failed | abandoned
  routedTo: text('routed_to'),                 // agent | ai
  handledByUserId: uuid('handled_by_user_id').references(() => users.id, { onDelete: 'set null' }), // which agent took it (CSAT by agent)
  handledByLabel: text('handled_by_label'),    // display label (agent name or 'AI agent')
  // Human takeover of an AI-handled call: when a user/agent takes over a call
  // the AI VAN agent is handling, this records who took it and when. The live
  // media layer drops the AI leg and bridges the human in.
  takenOverByUserId: uuid('taken_over_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  takenOverAt: timestamp('taken_over_at', { withTimezone: true }),
  contactId: uuid('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
  csatScore: integer('csat_score'),            // 1-5
  csatComment: text('csat_comment'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true })
}, (t) => ({
  tenantIdx: index('live_call_sessions_tenant_idx').on(t.tenantId),
  startedIdx: index('live_call_sessions_started_idx').on(t.startedAt)
}));

/* ---------- SIP endpoints (provisioned vendor trunks/connections) ----------
   Tracks SIP resources provisioned for a tenant on a real carrier (Twilio
   Elastic SIP Trunk, Telnyx credential connection, or a Digidite inbound
   registration). secretEnc holds any vendor-issued device password (AES-256-GCM,
   shown to the client once, never logged). */
export const sipEndpoints = pgTable('sip_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: providerKindEnum('provider').notNull(),     // twilio | telnyx | telroi
  kind: text('kind').notNull(),                          // trunk | credential_connection | registration
  externalId: text('external_id'),                       // TK… (Twilio) / connection id (Telnyx) / telnum (Digidite)
  label: text('label'),
  sipUsername: text('sip_username'),
  secretEnc: text('secret_enc'),                          // AES-256-GCM device password, if vendor-issued
  domain: text('domain'),                                // termination/registrar domain
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('sip_endpoints_tenant_idx').on(t.tenantId)
}));

/* ---------- API keys (for THIS dashboard's own API) ---------- */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  prefix: text('prefix').notNull().default('tlr_live'), // tlr_live | tlr_test
  last4: text('last4').notNull(),
  scopes: jsonb('scopes').$type<string[]>().default(['*']),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
});

/* ---------- Voice OTP service ----------
   A dedicated, OTP-ONLY voice service: Telroi places a call to the end-user and
   reads a one-time code aloud. The code is stored HASHED (never plaintext); the
   row tracks expiry, attempts and status so verification is safe and auditable.
   Rate limiting is enforced per destination number against the operator policy.
   This is intentionally separate from general calling — it cannot be used to
   place arbitrary calls, only to deliver+verify an OTP. */
export const voiceOtps = pgTable('voice_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  toNumber: text('to_number').notNull(),          // E.164 destination
  codeHash: text('code_hash').notNull(),           // sha256(code) — never store plaintext
  codeLength: integer('code_length').notNull(),
  status: text('status').notNull().default('pending'), // pending | calling | delivered | verified | failed | expired
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  provider: text('provider'),                      // resolved vendor that placed the call
  providerRef: text('provider_ref'),               // vendor call id
  reason: text('reason'),                          // failure/last-status detail
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  byTenant: index('voice_otps_tenant_idx').on(t.tenantId),
  byTo: index('voice_otps_to_idx').on(t.tenantId, t.toNumber),
  byStatus: index('voice_otps_status_idx').on(t.tenantId, t.status)
}));

/* ---------- Speech jobs (TTS / STT) ----------
   Records each text-to-speech synthesis or speech-to-text transcription request
   made via the public API, with the resolved vendor and result location. The
   actual audio synthesis/transcription runs on the configured vendor; this row
   is the durable record + status the API returns and polls. */
export const speechJobs = pgTable('speech_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                    // tts | stt
  status: text('status').notNull().default('queued'), // queued | processing | done | failed
  provider: text('provider'),                      // resolved vendor
  voice: text('voice'),                            // tts voice id
  format: text('format'),                          // mp3 | wav | ...
  inputChars: integer('input_chars'),              // tts: length of input text
  resultUrl: text('result_url'),                   // tts: audio url | stt: n/a
  transcript: text('transcript'),                  // stt result
  durationMs: integer('duration_ms'),
  reason: text('reason'),                          // failure detail
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (t) => ({
  byTenant: index('speech_jobs_tenant_idx').on(t.tenantId)
}));

/* ---------- Wallet & billing ----------
   MONEY-SAFETY RULES encoded here:
   - balances are INTEGER minor units (kobo / cents) — never floats
   - the ledger is immutable; balance is reconstructable from it
   - wallets are credited ONLY by a verified payment webhook, never the browser
   - debits are atomic with a hard stop at zero (see server/utils/wallet.ts) */
export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  currency: currencyEnum('currency').notNull().default('USD'),
  balanceMinor: integer('balance_minor').notNull().default(0), // kobo or cents
  plan: planEnum('plan').notNull().default('startup'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: uniqueIndex('wallets_tenant_idx').on(t.tenantId)
}));

/* Immutable ledger — every credit and debit, with running context. */
export const ledger = pgTable('ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: ledgerKindEnum('kind').notNull(),
  amountMinor: integer('amount_minor').notNull(),       // always positive; kind gives direction
  balanceAfterMinor: integer('balance_after_minor').notNull(),
  reason: text('reason').notNull(),                      // e.g. 'voice_minute', 'topup', 'plan_fee'
  reference: text('reference'),                          // payment ref / call id / idempotency key
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  // Sandbox entries record what a transaction WOULD cost without touching the
  // real balance — visible in finance logs, tagged + filterable, never counted
  // in real revenue/balance totals.
  sandbox: boolean('sandbox').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  walletIdx: index('ledger_wallet_idx').on(t.walletId),
  refIdx: index('ledger_ref_idx').on(t.reference)
}));

/* Top-up payments via Paystack / Stripe. Credited only on verified webhook. */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),                 // paystack | stripe
  reference: text('reference').notNull(),               // provider transaction ref
  amountMinor: integer('amount_minor').notNull(),
  currency: currencyEnum('currency').notNull(),
  status: paymentStatusEnum('status').notNull().default('pending'),
  creditedAt: timestamp('credited_at', { withTimezone: true }),
  raw: jsonb('raw').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  refIdx: uniqueIndex('payments_ref_idx').on(t.reference)
}));

/* Configurable pricing (minor units in USD; NGN derived by fx). Single row. */
export const pricing = pgTable('pricing', {
  id: text('id').primaryKey().default('singleton'),
  voiceMinuteUsdMinor: integer('voice_minute_usd_minor').notNull().default(1),  // $0.0102 ≈ rounded per-min; see meta for precise
  channelMonthlyUsdMinor: integer('channel_monthly_usd_minor').notNull().default(200), // $2.00
  didMonthlyUsdMinor: integer('did_monthly_usd_minor').notNull().default(170),          // $1.70
  planStartupUsdMinor: integer('plan_startup_usd_minor').notNull().default(1000),       // $10
  planGrowthUsdMinor: integer('plan_growth_usd_minor').notNull().default(1500),         // $15
  ngnPerUsd: integer('ngn_per_usd').notNull().default(1600),
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/* Reserved virtual accounts (Monnify) — one dedicated bank account per
   workspace that Nigerian users transfer into to fund their wallet.
   Credited via the verified Monnify webhook only. */
export const virtualAccounts = pgTable('virtual_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('monnify'),
  accountReference: text('account_reference').notNull(), // our reference, also used to match webhooks
  accountName: text('account_name').notNull(),
  accountNumber: text('account_number'),                 // the Moniepoint account number
  bankName: text('bank_name'),
  bankCode: text('bank_code'),
  accounts: jsonb('accounts').$type<Array<Record<string, unknown>>>().default([]), // all partner-bank accounts
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: uniqueIndex('virtual_accounts_tenant_idx').on(t.tenantId),
  refIdx: index('virtual_accounts_ref_idx').on(t.accountReference)
}));

/* Compliance submissions — required before a workspace can go from sandbox to
   live. Stores the official company name and uploaded license references.
   Reviewed by an operator; live mode unlocks on approval. */
export const compliance = pgTable('compliance', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  officialName: text('official_name').notNull(),
  // Uploaded documents stored in R2 (or local fallback). We keep the object key
  // plus the original filename + content type so the admin can stream it back.
  businessLicenseKey: text('business_license_key'),
  businessLicenseName: text('business_license_name'),
  businessLicenseType: text('business_license_type'),
  regulatoryLicenseKey: text('regulatory_license_key'),
  regulatoryLicenseName: text('regulatory_license_name'),
  regulatoryLicenseType: text('regulatory_license_type'),
  status: text('status').notNull().default('pending'),  // pending | approved | rejected
  notes: text('notes'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true })
}, (t) => ({
  tenantIdx: uniqueIndex('compliance_tenant_idx').on(t.tenantId)
}));

/* Admin-curated inventory of available numbers customers can buy. Region drives
   which voice providers a number is compatible with (enforced at attach time).
   region 'NG' -> [telroi]; 'US'|'CA'|'GB' -> [twilio, telnyx]. */
export const numberInventory = pgTable('number_inventory', {
  id: uuid('id').primaryKey().defaultRandom(),
  telnum: text('telnum').notNull(),
  region: text('region').notNull(),                  // ISO-ish: NG, US, CA, GB
  provider: text('provider').notNull().default('telroi'), // carrier it's provisioned on (admin-set, invisible to customer)
  provisionStatus: text('provision_status').notNull().default('unprovisioned'), // unprovisioned | provisioned | failed
  provisionRef: text('provision_ref'),  // carrier-side id (e.g. Twilio SID) once provisioned
  monthlyUsdMinorOverride: integer('monthly_usd_minor_override'), // optional price override
  status: text('status').notNull().default('available'), // available | reserved | sold
  soldToTenantId: uuid('sold_to_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  telnumIdx: uniqueIndex('number_inventory_telnum_idx').on(t.telnum),
  statusIdx: index('number_inventory_status_idx').on(t.status)
}));

/* Billable number subscriptions. Each purchased number carries a monthly DID
   fee + per-channel fee, debited from the wallet on purchase and each cycle.
   Airtime is billed separately per-call via the webhook. */
export const blacklist = pgTable('blacklist', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  telnum: text('telnum').notNull(),          // blocked number (or prefix)
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('blacklist_tenant_idx').on(t.tenantId),
  uniqByTenant: uniqueIndex('blacklist_tenant_telnum_idx').on(t.tenantId, t.telnum)
}));

export const numberSubscriptions = pgTable('number_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  telnum: text('telnum').notNull(),
  region: text('region').notNull().default('NG'),
  provider: text('provider').notNull().default('telroi'), // carried from inventory; invisible to customer
  channels: integer('channels').notNull().default(1),
  status: text('status').notNull().default('active'),  // active | suspended | cancelled
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  // Unified inbound routing (carrier-agnostic). One model for every number
  // regardless of vendor: route an incoming call to a person, a department, or
  // an AI agent. For 'ai', a VAN is synced under the hood; the customer never
  // sees the carrier or the VAN concept here.
  routeType: text('route_type').notNull().default('person'), // person | department | ai
  routeTarget: text('route_target'),                          // person: extension/user; (department uses departmentId)
  routeAgentId: uuid('route_agent_id').references(() => aiAgents.id, { onDelete: 'set null' }),
  routeEscalateTo: text('route_escalate_to'),                 // AI: human handoff target
  routeEscalateAfter: integer('route_escalate_after').default(0),
  // Lazy provisioning: numbers are 'local' until first used after go-live, then
  // provisioned on the country's vendor and billed from that point.
  provisionState: text('provision_state').notNull().default('local'), // local | provisioning | provisioned
  provisionRef: text('provision_ref'),  // carrier-side id once provisioned
  provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
  nextBillingAt: timestamp('next_billing_at', { withTimezone: true }).notNull(),
  lastBilledAt: timestamp('last_billed_at', { withTimezone: true })
}, (t) => ({
  tenantIdx: index('number_subs_tenant_idx').on(t.tenantId),
  telnumIdx: uniqueIndex('number_subs_telnum_idx').on(t.telnum)
}));

/* Per-tenant pricing overrides. Any null field falls back to the global
   singleton pricing row. Lets the operator give a specific client custom rates. */
export const pricingOverrides = pgTable('pricing_overrides', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  voiceMinuteUsdMinor: integer('voice_minute_usd_minor'),
  channelMonthlyUsdMinor: integer('channel_monthly_usd_minor'),
  didMonthlyUsdMinor: integer('did_monthly_usd_minor'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/* Saved card-on-file (provider-agnostic). We NEVER store raw card data — only
   the provider's token/reference plus display-safe metadata (brand, last4).
   Tokenization happens client-side via the provider SDK (Stripe Elements /
   Paystack). A card is collected at signup; charged $0 until the trial ends. */
export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),          // stripe | paystack
  token: text('token').notNull(),                // provider payment-method / authorization token
  brand: text('brand'),                          // e.g. visa, mastercard
  last4: text('last4'),
  expMonth: integer('exp_month'),
  expYear: integer('exp_year'),
  isDefault: boolean('is_default').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('payment_methods_tenant_idx').on(t.tenantId)
}));

/* Lightweight, auto-expiring activity log. Two kinds: 'call' (call lifecycle)
   and 'system' (everything else — plan changes, purchases, KYC, logins).
   Kept deliberately small (no payloads) and pruned after 60 days so volume
   stays cheap. expiresAt drives the prune job. */
/* Admin audit trail — WHO did WHAT, permanently (no expiry). Every mutating
   admin action (POST/PATCH/DELETE to /api/admin/*) is recorded with the acting
   operator's email + role, so changes are attributable and searchable. */
export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorEmail: text('actor_email').notNull(),       // which operator
  actorRole: text('actor_role'),                   // superadmin | staff (at time of action)
  method: text('method').notNull(),                // POST | PATCH | DELETE | PUT
  path: text('path').notNull(),                    // e.g. /api/admin/pricing
  action: text('action'),                          // friendly action key when known
  summary: text('summary'),                        // human-readable description
  status: integer('status'),                       // HTTP status outcome
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  actorIdx: index('admin_audit_actor_idx').on(t.actorEmail),
  createdIdx: index('admin_audit_created_idx').on(t.createdAt)
}));

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),        // call | system
  action: text('action').notNull(),    // dotted action key, e.g. 'number.purchased'
  summary: text('summary'),            // short human string (no large payloads)
  level: text('level').notNull().default('info'), // info | warn | error
  ref: text('ref'),                    // optional external id (callid, payment ref)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
}, (t) => ({
  kindIdx: index('logs_kind_idx').on(t.kind),
  tenantIdx: index('logs_tenant_idx').on(t.tenantId),
  createdIdx: index('logs_created_idx').on(t.createdAt),
  expiresIdx: index('logs_expires_idx').on(t.expiresAt)
}));

/* Plan feature catalog (singleton config, admin-editable). Maps each feature key
   to the set of plans that unlock it. Defaults mirror the marketing matrix:
   the Telroi One suite unlocks on growth+; core voice is on every plan. */
export const planFeatures = pgTable('plan_features', {
  key: text('key').primaryKey(),          // e.g. 'crm', 'dialer', 'messenger'
  label: text('label').notNull(),         // human label shown in UI
  startup: boolean('startup').notNull().default(true),
  growth: boolean('growth').notNull().default(true),
  custom: boolean('custom').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/* Per-client feature overrides. A row here forces a feature on/off for one
   tenant regardless of plan — lets the operator grant or revoke individually. */
export const tenantFeatureOverrides = pgTable('tenant_feature_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  enabled: boolean('enabled').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  uniq: uniqueIndex('tenant_feature_idx').on(t.tenantId, t.featureKey)
}));

/* ---------- Audit log ---------- */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  actor: text('actor'),
  action: text('action').notNull(),
  target: text('target'),
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type AiConnection = typeof aiConnections.$inferSelect;

/* ---------- Connect flow node/workflow shapes ---------- */
export interface ConnectNode {
  id: string;
  type: 'greeting' | 'menu' | 'route_user' | 'route_group' | 'route_van' | 'voicemail' | 'hangup';
  label?: string;
  // greeting/voicemail: mediaId or text; menu: options [{ digit, nextId }];
  // route_*: target (login/group id/van id)
  config: Record<string, any>;
}
export interface ConnectWorkflow {
  id: string;
  trigger: 'call_answered' | 'call_missed' | 'call_ended' | 'rating_received';
  action: 'crm_write' | 'webhook' | 'sms_notify';
  config: Record<string, any>;
}

// Platform carrier trunks (Ruach/Kasooko/Sotel + any added via admin). These are
// shared infrastructure (one trunk serves all tenants), managed by superadmins.
// The authoritative Asterisk config is generated on the PBX by the provisioning
// agent (carrier-core.ts); this table is the app-side record + secrets store.
export const carriers = pgTable('carriers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),       // slug: lowercase a-z0-9 (e.g. "ruach")
  displayName: text('display_name').notNull(),
  prefix: text('prefix').notNull().unique(),    // dial prefix, e.g. "81"
  region: text('region').notNull().default('NG'),
  sipGateway: text('sip_gateway').notNull(),    // gateway IP or host
  sipPort: integer('sip_port').notNull().default(5060),
  transport: text('transport').notNull().default('udp'),  // udp|tcp|tls
  sipDomain: text('sip_domain'),                // dial domain (default = gateway)
  authUser: text('auth_user'),                  // blank => IP-auth
  authPassEnc: text('auth_pass_enc'),           // encrypted
  fromUser: text('from_user'),                  // trunk From user / default CID number
  callerId: text('caller_id'),                  // default CID (fallback if ODBC empty)
  codecs: jsonb('codecs').$type<string[]>().default(['ulaw', 'alaw']),
  webhookSecretEnc: text('webhook_secret_enc'), // encrypted inbound webhook secret
  enabled: boolean('enabled').notNull().default(true),
  status: text('status').notNull().default('unknown'),  // last-known PBX status
  pushedAt: timestamp('pushed_at', { withTimezone: true }), // last successful PBX push
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// Per-turn AI usage detail for voice agents. One row per completed turn.
export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => aiAgents.id, { onDelete: 'set null' }),
  callId: text('call_id'),
  managed: boolean('managed').notNull().default(false),
  sttSeconds: integer('stt_seconds').notNull().default(0),
  llmInputTokens: integer('llm_input_tokens').notNull().default(0),
  llmOutputTokens: integer('llm_output_tokens').notNull().default(0),
  ttsChars: integer('tts_chars').notNull().default(0),
  costMinorUsd: integer('cost_minor_usd').notNull().default(0),
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  tenantIdx: index('ai_usage_tenant_idx').on(t.tenantId),
  callIdx: index('ai_usage_call_idx').on(t.callId)
}));
