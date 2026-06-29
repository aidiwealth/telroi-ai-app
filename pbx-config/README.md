# PBX Configuration (Asterisk)

Sanitized Asterisk configs for the Telroi PBX (`Telroi-PBX-Server`, London).
These make the PBX reproducible. **Secrets are replaced with `${PLACEHOLDER}` markers** —
fill them with real values (stored securely, NOT in git) before deploying.

## Files
- `pjsip.conf` — SIP transports, WebRTC (WSS 8089), carrier trunks (Ruach/Sotel/Kasooko), test users
- `extensions.conf` — dialplan: internal context, vendor prefix routes (81/82/83), inbound contexts, secure ODBC caller-ID
- `func_odbc.conf` — `ODBC_CALLERID_FOR` secure caller-ID lookup
- `res_odbc.conf` — ODBC connection to Postgres (realtime + caller-ID lookup)
- `http.conf` — ARI bound to 127.0.0.1 (localhost only); WebRTC TLS on 0.0.0.0:8089
- `modules.conf` — chan_sip noload (required so it doesn't intercept WebRTC)

## Placeholders to fill (real values stored securely, never committed)
- `${DB_PASSWORD}` (res_odbc.conf) — DigitalOcean managed Postgres password
- `${TEST1_PASSWORD}` / `${TEST2_PASSWORD}` (pjsip.conf) — test SIP user auth (consider removing test users in production)
- `CHANGEME_SOTEL_*` (pjsip.conf, extensions.conf) — Sotel carrier connection details, fill when provisioned

## Deploy location
Files install to `/etc/asterisk/`. After changes: `asterisk -rx "dialplan reload"` (extensions),
`asterisk -rx "pjsip reload"` (pjsip), `asterisk -rx "module reload func_odbc.so"` (func_odbc).

## Security notes
- ARI (8088) is localhost-only + firewalled
- UFW active: only 22, 80, 5060/udp, 8089, 8443, 10000-20000/udp open
- fail2ban asterisk jail bans SIP auth abuse

## nginx provisioning-agent proxy (nginx-provision-agent.conf)
Reverse-proxies the PBX agent (127.0.0.1:8090) to the public 8443 endpoint the web app calls.
Uses an explicit path allowlist (/provision, /deprovision, /health, /carrier/upsert, /carrier/remove).
Lives at /etc/nginx/sites-available/provision-agent (symlinked into sites-enabled).
NOTE: After adding new location blocks, run `systemctl restart nginx` — a `reload` does NOT
reliably pick up new location blocks.

## Per-carrier generated config (pjsip.d/ and extensions.d/)
Carriers are now provisioned through the admin Carriers page, which writes one file
per carrier via the provisioning agent:
- `pjsip.d/carrier-<name>.conf` — pure-transport trunk (endpoint/aor/identify, no
  hardcoded number; caller ID comes from the secure per-customer ODBC lookup).
- `extensions.d/carrier-<name>.conf` — outbound route `_<prefix>234XXXXXXXXXX` with
  reject-on-no-DID (Hangup 21 if the caller owns no DID on that carrier), plus the
  `[from-<name>]` inbound context.
Ruach (81) and Kasooko (82) were migrated from hand-written inline config to this
generated format. Sotel (83) is a disabled DB scaffold until real credentials exist.

### ⚠️ LOAD-BEARING INCLUDE — do not remove
`pjsip.conf` ends with `#include "pjsip.d/*.conf"`. This line loads ALL per-tenant and
per-carrier endpoints. If it is removed, every carrier + WebRTC tenant endpoint
silently disappears (calls fail) even though the .conf files still exist on disk.
When editing pjsip.conf near the end of the file (e.g. removing a trunk block), make
sure this include line survives. A greedy regex that matches to end-of-file will eat it.
