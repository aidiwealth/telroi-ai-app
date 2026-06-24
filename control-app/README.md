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

---

## Deployment note: control app on the NYC box (not co-located with Asterisk)

Current deployment: control app runs on the **NYC droplet**; Asterisk is on the
**London PBX droplet**. So the control app reaches ARI over the public TLS
endpoint instead of localhost.

`.env` on the NYC box:
```
ARI_URL=https://sip.telroi.ai:8089      # protocol+host only; client adds /ari + /ari/events
ARI_USERNAME=telroi
ARI_PASSWORD=<your ARI password>
ARI_APP_NAME=telroi
DATABASE_URL=<same as main app — local/fast on NYC>
```

### Prerequisites for this cross-box setup
1. **Firewall:** the London PBX firewall must allow inbound TCP **8089** from the
   NYC droplet's IP. (You already opened 8089 to All IPv4 for the main app, so
   this works — optionally tighten to the NYC droplet's IP later.)
2. **DB trusted sources:** the NYC droplet must be allowed on the DB (likely
   already is, since the main app is on NYC too).

### Verify ARI reachability from the NYC box first
Before running the app, confirm the NYC droplet can reach ARI over TLS:
```bash
curl -u telroi:YOUR_ARI_PASSWORD https://sip.telroi.ai:8089/ari/asterisk/info
```
Should return Asterisk info JSON. If it does, the REST path works. The app also
opens a WebSocket (wss://sip.telroi.ai:8089/ari/events) — if the app logs
"Connected" on startup, the WS path works too.

### Latency caveat (why London co-location is better long-term)
With the control app on NYC, every ARI command during a call (answer, play,
bridge) crosses NYC<->London (~80ms). That's noticeable on the live call path.
The cleaner placement is the **London PBX box** (ARI over localhost, DB via the
cache). To move it there later: set `ARI_URL=http://127.0.0.1:8088` and run it on
the London droplet. No code change — just the env var and the host.

---

## Stage 6 (bridge to SIP device) — current

The `person` route now **actually connects the call** instead of just logging.
Flow (see src/bridge.ts):
  1. Create a mixing bridge.
  2. Add the inbound caller to it.
  3. Originate an outbound leg to the target endpoint (BRIDGE_ENDPOINT, default
     PJSIP/test1) into our Stasis app.
  4. When the callee answers, add it to the bridge -> the two are connected.
  5. If either side hangs up, tear the bridge down cleanly.

The outbound leg re-enters Stasis marked with appArgs 'dialed'; index.ts skips
routing for that leg so it isn't treated as a new inbound call.

### Configure the bridge target
By default it bridges to `PJSIP/test1` (the test endpoint). Override in .env:
```
BRIDGE_ENDPOINT=PJSIP/test1
```
Later, when per-client SIP endpoints are provisioned, route_target will map to
the client's real endpoint and this fixed default goes away.

### Test
Ensure DID 700 maps to a `person` route (number_subscriptions), and a phone is
registered as `test1`. Dial 700 from a DIFFERENT registered phone — the call
should ring test1 and connect when answered. (Bridging to the same device you're
calling from won't work — you need two endpoints.)

---

## WS3 — Per-client SIP provisioning (Option B)

PJSIP Realtime is enabled on Asterisk (endpoints read from ps_endpoints/ps_auths/
ps_aors via ODBC). Provisioning a client device = inserting those rows; Asterisk
serves the endpoint instantly, no reload.

**Routing model (Option B):** number_subscriptions.route_target holds a
sip_endpoints.id (a stable UUID). The control app caches sip_endpoints (id ->
sip_username) and, for a person route, bridges to PJSIP/<sip_username>. Decoupling
the id from the username means SIP credentials can rotate without breaking routing.
If route_target doesn't resolve (empty/old test data), it falls back to
BRIDGE_ENDPOINT (default PJSIP/test1).

### Provision an endpoint
```
cd /opt/telroi-ai-app/control-app
npm run provision <tenantId> "Optional label"
```
This:
1. Generates a SIP username (tnt_xxxxxxxx) + strong password.
2. Inserts ps_aors / ps_auths / ps_endpoints (Asterisk serves it immediately).
3. Inserts a sip_endpoints row (Telroi's record), secret encrypted if
   ENCRYPTION_KEY is set (else plaintext — dev only).
4. Prints the credentials + the sip_endpoints.id.

Then: register a softphone with the printed username/password (domain
sip.telroi.ai, 5060/UDP), set a number_subscriptions.route_target to the printed
sip_endpoints.id, and dial that DID — the call bridges to the provisioned device.

Optional env for provisioning: SIP_DOMAIN, PROVISION_TRANSPORT (default
transport-udp), PROVISION_CONTEXT (default internal), ENCRYPTION_KEY (32-byte
hex/base64 for AES-256-GCM secret encryption).
