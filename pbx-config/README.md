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
