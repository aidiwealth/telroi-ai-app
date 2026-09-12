// control-app/src/twilio-trunk.ts
// The outbound trunk to Twilio.
//
// Twilio has been a second calling path rather than a carrier. The browser
// dialler uses Twilio's own Voice SDK and talks to their cloud directly,
// never touching this PBX — so a Twilio number could be called from a browser
// and not from a phone, because a native app speaks SIP to us and we had
// nowhere to route it.
//
// This is the trunk that closes that gap, shaped like the Telnyx one: same
// credential fetch, same file pair, same reload.
import { writeFileSync, chownSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PJSIP_D = process.env.PJSIP_D_DIR || '/etc/asterisk/pjsip.d';
const EXTENSIONS_D = process.env.EXTENSIONS_D_DIR || '/etc/asterisk/extensions.d';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.PROVISION_AGENT_SECRET || '';

function log(...a: unknown[]) { console.log(new Date().toISOString(), '[twilio-trunk]', ...a); }

function own(path: string) {
  try {
    const uid = Number(execSync('id -u asterisk').toString().trim());
    const gid = Number(execSync('id -g asterisk').toString().trim());
    chownSync(path, uid, gid);
  } catch { /* not fatal — Asterisk usually still reads it */ }
}

/** Build the trunk from the credentials the web app holds. Safe to re-run. */
export async function ensureTwilioTrunk(): Promise<boolean> {
  if (!INTERNAL_SECRET) { log('no internal secret — skipping'); return false; }

  let creds: any = null;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/internal/twilio-trunk`, {
      headers: { 'x-telroi-internal': INTERNAL_SECRET },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) { log(`credentials unavailable (HTTP ${res.status}) — no Twilio route`); return false; }
    creds = await res.json();
  } catch (e: any) {
    log(`could not fetch credentials (${e?.message || e}) — no Twilio route`);
    return false;
  }
  // Not configured is a normal state, not a fault: a platform may run the
  // browser path alone and never buy a Twilio number for an app to dial from.
  if (!creds?.configured) { log('not configured — no Twilio route'); return false; }
  if (!creds.sipUsername || !creds.sipPassword) { log('credentials incomplete'); return false; }

  const HOST = creds.sipDomain || 'telroi.pstn.twilio.com';

  const pjsip = `; Generated — do not edit. Credentials come from platform settings.
[twilio-out-auth]
type=auth
auth_type=userpass
username=${creds.sipUsername}
password=${creds.sipPassword}

[twilio-out-aor]
type=aor
contact=sip:${HOST}:5060
qualify_frequency=60

; A separate endpoint from the inbound one. Inbound identifies Twilio by their
; published edge ranges and needs no AOR; rewriting that file would risk live
; calls to gain outbound.
[twilio-out]
type=endpoint
transport=transport-udp
context=from-carrier
aors=twilio-out-aor
outbound_auth=twilio-out-auth
disallow=all
allow=ulaw
allow=alaw
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
from_domain=${HOST}
`;

  // The dialplan half, shaped like the others: resolve the caller's own DID for
  // this carrier, refuse if they hold none, dial, and log from a hangup handler
  // so an answered call the caller ends first is still recorded and charged.
  const dialplan = `; Generated — do not edit.
[carrier-twilio-out]
exten => _84X.,1,Set(DEST=\${EXTEN:2})
 same => n,Goto(twiliodial,1)
exten => twiliodial,1,NoOp(Twilio out -> \${DEST})
 same => n,Set(CHANNEL(hangup_handler_push)=telroi-log,s,1(twilio))
 same => n,Set(CID=\${ODBC_CALLERID_FOR(\${CHANNEL(endpoint)},twilio)})
 same => n,GotoIf($["\${CID}"=""]?nodid)
 same => n,Set(CALLERID(num)=\${CID})
 same => n,Set(CALLERID(name)=Telroi)
 same => n,Set(TELROI_START=\${EPOCH})
 same => n,Dial(PJSIP/twilio-out/sip:+\${DEST}@${HOST}:5060,60)
 same => n,Hangup()
 same => n(nodid),NoOp(Rejected: caller owns no DID on twilio)
 same => n,Hangup(21)
`;

  const pjsipPath = `${PJSIP_D}/carrier-twilio-out.conf`;
  const extPath = `${EXTENSIONS_D}/carrier-twilio-out.conf`;
  writeFileSync(pjsipPath, pjsip, { mode: 0o640 });
  writeFileSync(extPath, dialplan, { mode: 0o644 });
  own(pjsipPath); own(extPath);

  try {
    execSync('asterisk -rx "pjsip reload" && asterisk -rx "dialplan reload"');
    log(`trunk written and reloaded (host ${HOST})`);
    return true;
  } catch (e: any) {
    log(`written but reload failed: ${e?.message || e}`);
    return false;
  }
}
