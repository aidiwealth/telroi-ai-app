# Telroi — Customer Dashboard

AI-native voice infrastructure dashboard. A single Nuxt 3 application: the UI and the API live together as Nuxt pages + Nitro server routes, backed by PostgreSQL.

The product is layered so you're never locked in:

1. **Telroi managed PBX** (primary) — numbers, routing, IVR, recording and queues via the Digitide/Telroi CPBX REST API.
2. **Multi-vendor SIP** (secondary) — bring Twilio, Telnyx or PressOne over SIP without changing your routing.
3. **Bring-your-own AI keys** — connect your own OpenAI, Anthropic, Deepgram, ElevenLabs, VAPI or Google accounts. Telroi never charges you for model usage; you're billed by each provider directly.

## Quick start

```bash
npm install
cp .env.example .env        # then fill in the values

# generate the two secrets:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"

npm run db:generate         # create the migration from the schema
npm run db:migrate          # apply it
npm run db:seed             # optional: demo workspace (owner@acme.test)

npm run dev                 # http://localhost:3000
```

### Run without live Telroi credentials

The app ships with a local mock of the CPBX API so every screen works offline. Set:

```
TELROI_MOCK_URL=http://localhost:3000/_mock/crmapi/v1
```

Then sign in (the magic link + 6-digit code are printed to the dev console because `EMAIL_PROVIDER=console`), and the seeded `acme` workspace is wired to the mock.

## Architecture

```
assets/css/        tokens.css · base.css · components.css   (brand design system)
layouts/           bare (auth/onboarding) · default (app shell)
pages/             onboarding/ (sign-in + 5-step wizard) + dashboard screens
components/app/     AppSidebar · AppTopbar · DialerModal
stores/            auth (Pinia)
composables/       useApi · useToast
middleware/        auth.global.ts (route guard)

server/
  db/              Drizzle schema, client, migrate + seed
  utils/           crypto (AES-256-GCM) · session (JWT) · auth-core · email · api · tenant · ai-test
  utils/telroi/    client.ts — typed wrapper over the CPBX REST API
  api/             auth/ · tenant/ · voice/ · ai/ · webhooks/
  routes/_mock/    offline CPBX mock
  middleware/      01.auth.ts (attaches session to /api/**)
```

### Security

- Passwordless auth (magic link + OTP), sessions are signed JWTs in `httpOnly` cookies.
- All secrets at rest — Telroi API key, AI provider keys, carrier credentials — are encrypted with **AES-256-GCM**. AI keys are never returned to the browser (only a masked `••••••1234`).
- Every API route is tenant-scoped via `requireTenant`.
- Auth endpoints are rate-limited per email and per IP.
- The Telroi → CRM webhook is authenticated per-workspace by the PBX `crm_token`.

## Deploy (DigitalOcean App Platform)

```bash
doctl apps create --spec app.yaml
```

Set the `SECRET` env vars (`JWT_SECRET`, `ENCRYPTION_KEY`, `RESEND_API_KEY`) in the DO dashboard. A managed Postgres database is provisioned by the spec. The container is built from the included `Dockerfile` (Nitro `node-server` preset).

### Email delivery (production)

Email (login codes, member invites, email-change OTPs) is configured by **environment variables**, not the admin UI — transactional-email credentials are deploy-time secrets and are deliberately kept out of the database and out of any admin session (best practice; also avoids a lock-out if misconfigured, since email is how login codes are sent):

- `EMAIL_PROVIDER` — `console` (prints codes to stdout, for local/dev) or `resend` (sends real email).
- `RESEND_API_KEY` — your Resend API key; required when `EMAIL_PROVIDER=resend`.
- `EMAIL_FROM` — the From header, e.g. `Telroi <hello@telroi.ai>` (use a verified Resend domain in production).

For production: set `EMAIL_PROVIDER=resend`, add `RESEND_API_KEY`, and verify your sending domain in Resend. The admin Settings → Integrations card shows the current status (Console vs Resend) read-only.

## What's wired vs. scaffolded

Fully wired end-to-end: passwordless auth, the onboarding wizard, Overview, Calls (history + detail drawer + CSV export + call-back), AI connections (add / test / remove), and all read-paths for Numbers, Team, Departments, Blacklist and Telephony settings against the live (or mock) PBX.

Scaffolded with the same patterns and marked `// BUILD:` in code — number-routing writes, team-member writes, blacklist writes, the carrier connect drawer, outbound webhooks, dashboard API-key generation, and the voice-agent builder. Each has its UI in place and a matching client method on `TelroiClient`; finishing them is wiring an existing method to a thin server route.

## Public Developer API

Telroi exposes a public REST API at `/v1`, authenticated by per-tenant API keys
(`tlr_live_...`). This is the "platform" surface — your customers build on the
same infrastructure the dashboard uses, and you orchestrate down to the
partners (Digitide PBX, Twilio, Telnyx) on their behalf.

**Auth:** `Authorization: Bearer tlr_live_...` (or `X-API-Key`). Keys are minted
in the dashboard under **Developers**, hashed at rest (SHA-256), and shown once.

**Resources:**
- `GET  /v1/calls` — list call history
- `POST /v1/calls` — originate a call `{ phone, user? }`
- `GET  /v1/numbers` — list phone numbers
- `GET  /v1/agents` — list agents
- `GET  /v1/vans` — list Virtual AI Numbers
- `POST /v1/vans` — create a VAN `{ name, telnum, provider?, agentId? }`

Lists return `{ object: "list", data: [...] }`; errors return
`{ error: { code, message } }` with the matching HTTP status. Scopes are
enforced per key (`calls:read`, `vans:write`, etc.; `*` = full access).

### Architecture note (the "thin platform" model)
Telroi is designed as a lightweight orchestration plane, not a heavy backend:
telephony compute lives with the carriers (Digitide/Twilio/Telnyx), AI inference
runs on the customer's own provider keys, and Telroi holds only what it must own
— identity, provisioning, encrypted partner credentials, and API keys. Call data
is currently warehoused in Postgres for speed; this can be moved to live
read-through later to shed even that state.

## Wallet & billing

Prepaid wallet per workspace. Customers top up; features debit on use.

- **Currency** is set per workspace (NGN or USD). One wallet, one currency.
- **Top-up** routes to Paystack (NGN) or Stripe (USD). The browser only *starts*
  checkout — the wallet is credited ONLY when the provider's webhook arrives with
  a **valid signature** (`/api/webhooks/paystack`, `/api/webhooks/stripe`).
- **Balances** are integer minor units (kobo/cents) — never floats. Every
  movement writes an immutable `ledger` row; the balance is always reconstructable.
- **Debits** are atomic (row-locked transaction) with a **hard stop at zero** —
  no overdraft. They're idempotent by reference, so a webhook/event retry never
  double-charges.
- **Pricing** (configurable `pricing` row, seeded from the published rates):
  $0.0102/min airtime, $2/voice channel/mo, $1.70/DID/mo; plans Startup $10,
  Growth $15, Custom (quote). Airtime is computed in micro-units so the sub-cent
  rate doesn't round to zero. NGN derived at the configurable `ngnPerUsd` rate.

**What's wired:** airtime is debited when a completed-call event hits the Telroi
webhook (idempotent by call id); outbound calls are blocked at a zero balance.
Monthly plan/channel/DID fees have pricing + helpers in place but a scheduled
billing run (cron) to apply them is not yet built — that's the main billing
piece still to add.

### Setting up payment webhooks
Point your Paystack and Stripe dashboards at `{APP_BASE_URL}/api/webhooks/paystack`
and `/api/webhooks/stripe`. Set `STRIPE_WEBHOOK_SECRET` to the signing secret
Stripe shows for that endpoint. Without these, top-ups initialize but never credit.

## Monnify — Nigerian bank-transfer top-ups (virtual accounts)

For NGN workspaces, in addition to Paystack card top-ups, customers can fund via
**bank transfer** to a dedicated virtual account (Moniepoint MFB, via Monnify):

- **One reserved account per workspace**, created once via the Monnify Reserve
  Account API (`/api/v2/bank-transfer/reserved-accounts`). CBN rules require a
  **BVN or NIN**, collected before the account is created.
- The account number is shown on the Wallet page; the user transfers any amount
  to it from any bank.
- **Credit is webhook-only.** When a transfer lands, Monnify POSTs to
  `/api/webhooks/monnify` with a `monnify-signature` header — HMAC-SHA512 of the
  raw body keyed with your **Client Secret**. We verify it, then credit the
  wallet (idempotent by transaction reference; a re-sent webhook never
  double-credits). The browser never credits.

### Config (.env)
`MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_ENV`
(`sandbox` or `live`). Set your Transaction Completion webhook URL in the Monnify
dashboard to `{APP_BASE_URL}/api/webhooks/monnify`. As an extra layer, Monnify
recommends IP-whitelisting their notification IPs at your edge/proxy.
