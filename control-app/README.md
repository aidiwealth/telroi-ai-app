# Telroi Control App (ARI call brain)

A standalone Node service that runs **on the Asterisk Droplet**. It connects to
Asterisk's ARI, receives inbound calls that enter `Stasis(telroi)` (dialplan
extension 700 and, later, the inbound carrier contexts), and routes them using
Telroi's shared routing logic (blacklist → CRM → AI / person / department).

It is intentionally **separate from the Nuxt app** (which runs on DigitalOcean
App Platform). This service is long-running and stateful (holds an ARI
WebSocket), which suits a dedicated process next to Asterisk far better than a
stateless request/response app. It reads the **same Postgres** as Telroi.

## Stage 1 (current)
Connect to ARI, log every call entering `Stasis(telroi)`, answer it, play a
test message, hang up. This proves the control loop works end-to-end.

Later stages add: DID→client resolution, blacklist rejection, CRM logging, AI
agent, and bridging to the client's SIP device.

---

## Deploy on the Asterisk Droplet

```bash
# 1. Get the code onto the Droplet (clone the repo, or pull if already there)
cd /opt
git clone https://github.com/aidiwealth/telroi-ai-app.git
cd telroi-ai-app/control-app

# 2. Install dependencies
npm install

# 3. Configure
cp .env.example .env
nano .env        # set ARI_PASSWORD (and DATABASE_URL later, for Stage 2)

# 4. Run it (Stage 1 — manual, to watch the logs)
npm start
```

Then from your softphone dial **700** — you should see a `StasisStart` log line
and hear the test message. That confirms ARI control works.

## Run it as a service (once proven)

Use a process manager so it stays up and restarts on reboot. Two options:

**pm2:**
```bash
npm install -g pm2
pm2 start npm --name telroi-control -- start
pm2 save
pm2 startup        # follow the printed instruction to enable on boot
```

**systemd** (`/etc/systemd/system/telroi-control.service`):
```ini
[Unit]
Description=Telroi ARI Control App
After=network.target asterisk.service

[Service]
WorkingDirectory=/opt/telroi-ai-app/control-app
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
EnvironmentFile=/opt/telroi-ai-app/control-app/.env

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload
systemctl enable --now telroi-control
journalctl -u telroi-control -f      # watch logs
```

## Requirements
- Node 20+ on the Droplet (`node --version`). If older, install Node 22.
- ARI enabled on Asterisk (already done): `ari.conf` user `telroi`, and the
  dialplan has `exten => 700,1,...Stasis(telroi)`.
- For Stage 2+: the Droplet's IP must be in the database **Trusted Sources**.

---

## Stage 2 (cache-backed routing) — current

The app now resolves calls against a **local in-memory cache** (Option 1 for the
London-PBX / NYC-DB split):

- On startup it loads `number_subscriptions` (DID→client+routing), `blacklist`,
  and `ai_agents` greetings from NYC into RAM, then refreshes every 30s
  (`CACHE_REFRESH_MS`).
- Per-call routing reads only from RAM — no transatlantic query on the call path.
- Call logs are written to NYC **async / fire-and-forget** — the caller never
  waits on a write.

Pipeline per inbound call: resolve DID→client → blacklist check → log (async) →
route (ai / person / department / reject). Stages 3+ add the real AI pipeline and
bridging to client SIP devices; the routing *decision* logic is already final.

### Prerequisite for Stage 2: database access from the Droplet
The control app (London Droplet) must reach the NYC Postgres. Add the Droplet's
public IP to the database **Trusted Sources**:

  DigitalOcean → Databases → your DB → Settings → Trusted Sources → add 159.65.86.193

Then set `DATABASE_URL` in `.env` to the same connection string the main app uses.

### The schema is self-contained
`src/schema.ts` is a minimal local copy of just the tables this app touches, so
`control-app/` deploys standalone without the parent repo's node_modules. If you
add a routing column in the main app that the control app needs, mirror it there.

### Inbound dialplan note
For inbound calls, pass the dialed DID to the app as the first Stasis arg, e.g.
in extensions.conf:  `exten => _X.,1,Stasis(telroi,${EXTEN})`
The app reads `event.args[0]` as the DID (falling back to the channel exten).
