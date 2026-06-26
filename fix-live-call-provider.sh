#!/usr/bin/env bash
# Fix: route live-call provider resolution + WebRTC token to telroi (our Asterisk)
# instead of the removed digidite/sotel/ruach. Run from repo root on main.
# Then: npx nuxi build -> green -> commit.
set -e
cd "$(git rev-parse --show-toplevel)"

python3 - << 'PY'
p='server/utils/live-call-provider.ts'; s=open(p).read()
import re
s=s.replace("export type VoiceProvider = 'digidite' | 'telnyx' | 'twilio' | 'sotel' | 'asterisk' | 'ruach';",
            "export type VoiceProvider = 'telroi' | 'telnyx' | 'twilio';")
s=s.replace("""// Map our schema's provider naming: 'telroi' (PBX) == Digidite.
function normalize(p: string): VoiceProvider {
  if (p === 'telroi' || p === 'digidite' || p === 'pbx') return 'digidite';""",
            """// Map our schema's provider naming: 'telroi' is our own Asterisk PBX.
function normalize(p: string): VoiceProvider {
  if (p === 'telroi' || p === 'digidite' || p === 'pbx' || p === 'asterisk') return 'telroi';""")
s=re.sub(r"\n  if \(p === 'sotel'\) return 'sotel';","",s)
s=re.sub(r"\n  if \(p === 'asterisk'\) return 'asterisk';","",s)
s=re.sub(r"\n  if \(p === 'ruach'\) return 'ruach';","",s)
s=s.replace("""  if (cfg === 'sotel') {
    // Admin explicitly chose Sotel — honor it exactly.
    provider = 'sotel'; reason = 'admin override (sotel)';
  } else if (cfg === 'ruach') {
    // Admin explicitly chose Ruach — honor it exactly. No automated fallback:
    // the admin decides which vendor powers this number/region.
    provider = 'ruach'; reason = 'admin override (ruach)';
  } else if (cfg === 'asterisk') {
    // Admin explicitly chose Asterisk (global).
    provider = 'asterisk'; reason = 'admin override (asterisk)';
  } else if (cfg === 'digidite' || cfg === 'telnyx' || cfg === 'twilio') {
    provider = cfg as VoiceProvider; reason = `admin override (${cfg})`;
  } else {
    // auto: Nigeria -> Sotel if its trunk is configured, else Digidite; non-NG -> Telnyx.
    // If the from-number's own provider is known, prefer that (number already on it).
    if (from.provider) { provider = from.provider; reason = `number's carrier (${from.provider})`; }
    else if (ng) {
      let sotelReady = false;
      try { const c = await voiceCredentials(); sotelReady = !!c?.sotel?.sipGateway; } catch { /* */ }
      if (sotelReady) { provider = 'sotel'; reason = 'auto: Nigeria -> Sotel (trunk configured)'; }
      else { provider = 'digidite'; reason = 'auto: Nigeria -> Digidite'; }
    }
    else { provider = 'telnyx'; reason = 'auto: non-Nigeria -> Telnyx'; }
  }""",
            """  if (cfg === 'asterisk' || cfg === 'digidite' || cfg === 'telroi' || cfg === 'pbx') {
    // Admin chose our own PBX (Telroi Voice).
    provider = 'telroi'; reason = 'admin override (telroi)';
  } else if (cfg === 'telnyx' || cfg === 'twilio') {
    provider = cfg as VoiceProvider; reason = `admin override (${cfg})`;
  } else {
    // auto: Nigeria -> Telroi Voice (our Asterisk); non-NG -> Telnyx.
    if (from.provider) { provider = from.provider; reason = `number's carrier (${from.provider})`; }
    else if (ng) { provider = 'telroi'; reason = 'auto: Nigeria -> Telroi Voice'; }
    else { provider = 'telnyx'; reason = 'auto: non-Nigeria -> Telnyx'; }
  }""")
s=s.replace("""    if (provider === 'digidite') ready = !!creds?.telroiPbx;
    else if (provider === 'telnyx') ready = !!creds?.telnyx;
    else if (provider === 'twilio') ready = !!creds?.twilio;
    else if (provider === 'sotel') { const c = await voiceCredentials(); ready = !!c?.sotel?.sipGateway; }
    else if (provider === 'asterisk') { const c = await voiceCredentials(); ready = !!c?.asterisk?.sipGateway; }
    else if (provider === 'ruach') { const c = await voiceCredentials(); ready = !!c?.ruach?.sipAccount; }""",
            """    if (provider === 'telroi') ready = provisionAgentConfigured();
    else if (provider === 'telnyx') ready = !!creds?.telnyx;
    else if (provider === 'twilio') ready = !!creds?.twilio;""")
s=s.replace("import { voiceCredentials } from './voice-credentials';\n","")
if "import { provisionAgentConfigured }" not in s:
    s=s.replace("import { masterCarrierCreds } from './platform';",
                "import { masterCarrierCreds } from './platform';\nimport { provisionAgentConfigured } from './provision-agent';")
open(p,'w').write(s); print("✓ live-call-provider.ts")
PY

python3 - << 'PY'
p='server/utils/voice-token.ts'; s=open(p).read()
import re
s=s.replace("""export async function voiceTokenFor(provider: string, identity: string) {
  if (provider === 'twilio') return await twilioVoiceToken(identity);
  if (provider === 'telnyx') return await telnyxVoiceToken();
  if (provider === 'digidite') return await digiditeVoiceToken();
  if (provider === 'sotel') return await sotelVoiceToken();
  if (provider === 'asterisk') return await asteriskVoiceToken();
  if (provider === 'ruach') return await ruachVoiceToken();
  throw new Error(`Unknown voice provider: ${provider}`);
}""",
            """export async function voiceTokenFor(provider: string, identity: string) {
  if (provider === 'twilio') return await twilioVoiceToken(identity);
  if (provider === 'telnyx') return await telnyxVoiceToken();
  if (provider === 'telroi' || provider === 'asterisk') return await asteriskVoiceToken();
  throw new Error(`Unknown voice provider: ${provider}`);
}""")
s=re.sub(r"\n// ── Digidite WebRTC/SIP:.*?\nexport async function digiditeVoiceToken\(\)[^\n]*\{.*?\n\}\n","\n",s,flags=re.S)
s=re.sub(r"\nexport async function sotelVoiceToken\(\)[^\n]*\{.*?\n\}\n","\n",s,flags=re.S)
s=re.sub(r"\nexport async function ruachVoiceToken\(\)[^\n]*\{.*?\n\}\n","\n",s,flags=re.S)
open(p,'w').write(s); print("✓ voice-token.ts")
PY

echo ""
echo "Now: npx nuxi build"
