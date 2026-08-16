// control-app/src/telnyx-trunk.ts
// The outbound trunk to Telnyx.
//
// An operator's browser registers to our own PBX, because registration decides
// where they can be RUNG and a department has to reach them. A Telnyx
// registration would place calls and never receive one. So an operator calling
// an international number needs the PBX itself to have a route there, which
// means a SIP trunk.
//
// Credentials come from the web app rather than a config file: they were entered
// once, they live encrypted in the database, and the encryption key has no
// business on the box most exposed to the world.
import { writeFileSync, chownSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PJSIP_D = process.env.PJSIP_D_DIR || '/etc/asterisk/pjsip.d';
const EXTENSIONS_D = process.env.EXTENSIONS_D_DIR || '/etc/asterisk/extensions.d';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.PROVISION_AGENT_SECRET || '';
const HOST = process.env.TELNYX_SIP_HOST || 'sip.telnyx.com';

function log(...a: unknown[]) { console.log(new Date().toISOString(), '[telnyx-trunk]', ...a); }

function own(path: string) {
  try {
    const uid = Number(execSync('id -u asterisk').toString().trim());
    const gid = Number(execSync('id -g asterisk').toString().trim());
    chownSync(path, uid, gid);
  } catch { /* not fatal — Asterisk usually still reads it */ }
}

/** Build the trunk from the credentials the web app holds. Safe to re-run: it
 *  writes the same files and reloads, so a credential change is one call. */
export async function ensureTelnyxTrunk(): Promise<boolean> {
  if (!INTERNAL_SECRET) { log('no internal secret — skipping'); return false; }

  let creds: { sipUsername?: string; sipPassword?: string } | null = null;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/internal/telnyx-trunk`, {
      headers: { 'x-telroi-internal': INTERNAL_SECRET },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) { log(`credentials unavailable (HTTP ${res.status}) — no international route`); return false; }
    creds = await res.json() as any;
  } catch (e: any) {
    log(`could not fetch credentials (${e?.message || e}) — no international route`);
    return false;
  }
  if (!creds?.sipUsername || !creds?.sipPassword) { log('credentials incomplete'); return false; }

  // A separate endpoint from the inbound one: inbound identifies Telnyx by their
  // signalling IPs and needs no AOR, and rewriting that file would put the live
  // AI calls at risk to gain outbound.
  const pjsip = `; Generated — do not edit. Credentials come from platform settings.
[telnyx-out-auth]
type=auth
auth_type=userpass
username=${creds.sipUsername}
password=${creds.sipPassword}

[telnyx-out-aor]
type=aor
contact=sip:${HOST}:5060
qualify_frequency=60

[telnyx-out]
type=endpoint
transport=transport-udp
context=from-carrier
aors=telnyx-out-aor
outbound_auth=telnyx-out-auth
disallow=all
allow=ulaw
allow=alaw
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
from_domain=${HOST}
`;

  // The dialplan half, shaped like the Nigerian carriers': resolve the caller's
  // own DID for this carrier, refuse if they hold none, dial, log.
  const dialplan = `; Generated — do not edit.
[carrier-telnyx-out]
exten => telnyxdial,1,NoOp(Telnyx out -> \${DEST})
 same => n,Set(CID=\${ODBC_CALLERID_FOR(\${CHANNEL(endpoint)},telnyx)})
 same => n,GotoIf($["\${CID}"=""]?nodid)
 same => n,Set(CALLERID(num)=\${CID})
 same => n,Set(CALLERID(name)=Telroi)
 same => n,Set(TELROI_START=\${EPOCH})
 same => n,Dial(PJSIP/telnyx-out/sip:\${DEST}@${HOST}:5060,60)
 same => n,Set(TELROI_LOG=\${CURL(http://127.0.0.1:8090/log-outbound?callid=\${UNIQUEID}&agent=\${CHANNEL(endpoint)}&dialed=\${DEST}&carrier=telnyx&dialstatus=\${DIALSTATUS}&hangupcause=\${HANGUPCAUSE}&duration=\${CDR(billsec)}&start=\${TELROI_START})})
 same => n,Hangup()
 same => n(nodid),NoOp(Rejected: caller owns no DID on telnyx)
 same => n,Hangup(21)
`;

  const pjsipPath = `${PJSIP_D}/carrier-telnyx-out.conf`;
  const extPath = `${EXTENSIONS_D}/carrier-telnyx-out.conf`;
  writeFileSync(pjsipPath, pjsip, { mode: 0o640 });
  writeFileSync(extPath, dialplan, { mode: 0o644 });
  own(pjsipPath); own(extPath);

  try {
    execSync('asterisk -rx "pjsip reload" && asterisk -rx "dialplan reload"');
    log('trunk written and reloaded');
    return true;
  } catch (e: any) {
    log(`written but reload failed: ${e?.message || e}`);
    return false;
  }
}
