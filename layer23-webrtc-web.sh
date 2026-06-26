#!/usr/bin/env bash
# Layers 2-3: WebRTC browser dialer on Telroi Voice (Asterisk).
# - asteriskVoiceToken provisions/reuses a WebRTC endpoint, returns SIP.js creds
# - useVoiceCall SIP.js branch handles telroi/asterisk
# - sipWsServer runtime config
# Run from repo root on main. Then: npx nuxi build -> green -> commit.
set -e
cd "$(git rev-parse --show-toplevel)"

# 1. agentProvision accepts webrtc flag
python3 - << 'PY'
p='server/utils/provision-agent.ts'; s=open(p).read()
if 'webrtc = false' not in s:
    s=s.replace(
"export async function agentProvision(tenantId: string, label: string): Promise<AgentProvisionResult> {\n  const j = await agentCall('/provision', { tenantId, label });",
"export async function agentProvision(tenantId: string, label: string, webrtc = false): Promise<AgentProvisionResult> {\n  const j = await agentCall('/provision', { tenantId, label, webrtc });")
    open(p,'w').write(s); print("✓ provision-agent.ts")
else: print("• provision-agent.ts already updated")
PY

# 2. asteriskVoiceToken: provision WebRTC endpoint, return SIP.js shape
python3 - << 'PY'
p='server/utils/voice-token.ts'; s=open(p).read()
old = """export async function asteriskVoiceToken() {
  const { asterisk } = await voiceCredentials();
  if (!asterisk || !asterisk.sipGateway) throw new Error('Asterisk SIP trunk not configured');
  return {
    provider: 'asterisk',
    sipGateway: asterisk.sipGateway,
    sipPort: asterisk.sipPort || 5060,
    transport: asterisk.transport || 'udp',
    sipDomain: asterisk.sipDomain || asterisk.sipGateway,
    authUser: asterisk.authUser || '',
    authPass: asterisk.authPass || '',
    callerId: asterisk.callerId || (asterisk.dids && asterisk.dids[0]) || '',
    dids: asterisk.dids || [],
    apiBaseUrl: asterisk.apiBaseUrl || '', ariAppName: asterisk.ariAppName || ''
  };
}"""
new = """export async function asteriskVoiceToken(identity: string) {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq } = await import('drizzle-orm');
  const { decrypt, encrypt } = await import('~/server/utils/crypto');
  const { agentProvision, provisionAgentConfigured } = await import('~/server/utils/provision-agent');
  const { useRuntimeConfig } = await import('#imports');

  if (!provisionAgentConfigured()) throw new Error('Voice platform is not configured');

  const m = /^tenant_([0-9a-f-]+)_/.exec(identity);
  const tenantId = m ? m[1] : identity;

  const db = useDb();
  const rows = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, tenantId), eq(schema.sipEndpoints.provider, 'telroi')));
  let ep = rows.find((r: any) => (r.meta as any)?.webrtc === true && r.secretEnc);

  let sipUsername: string;
  let sipPassword: string;
  if (ep) {
    sipUsername = ep.sipUsername!;
    sipPassword = decrypt(ep.secretEnc!);
  } else {
    const result = await agentProvision(tenantId, 'browser-dialer', true);
    sipUsername = result.username;
    sipPassword = result.password;
    await db.insert(schema.sipEndpoints).values({
      tenantId, provider: 'telroi', kind: 'registration',
      externalId: result.username, label: 'browser-dialer', sipUsername: result.username,
      secretEnc: encrypt(result.password), domain: result.domain,
      meta: { transport: result.transport, webrtc: true }
    });
  }

  const cfg = useRuntimeConfig();
  const sipDomain = process.env.SIP_DOMAIN || 'sip.telroi.ai';
  const wsServer = cfg.public?.sipWsServer || `wss://${sipDomain}:8089/ws`;

  return { provider: 'telroi', sipUsername, sipPassword, sipDomain, wsServer };
}"""
assert old in s, "asteriskVoiceToken not found (already applied?)"
s=s.replace(old,new)
s=s.replace(
"  if (provider === 'telroi' || provider === 'asterisk') return await asteriskVoiceToken();",
"  if (provider === 'telroi' || provider === 'asterisk') return await asteriskVoiceToken(identity);")
open(p,'w').write(s); print("✓ voice-token.ts")
PY

# 3. useVoiceCall SIP.js branch handles telroi/asterisk
python3 - << 'PY'
p='composables/useVoiceCall.ts'; s=open(p).read()
s=s.replace("      } else if (provider === 'digidite') {",
            "      } else if (provider === 'digidite' || provider === 'telroi' || provider === 'asterisk') {")
s=s.replace("      if (provider === 'digidite' && activeConn) { activeConn.bye?.().catch(() => {}); activeConn.cancel?.().catch(() => {}); }",
            "      if ((provider === 'digidite' || provider === 'telroi' || provider === 'asterisk') && activeConn) { activeConn.bye?.().catch(() => {}); activeConn.cancel?.().catch(() => {}); }")
s=s.replace("// Supports Twilio Voice, Telnyx WebRTC, and Digidite (SIP.js over WebSocket).",
            "// Supports Twilio Voice, Telnyx WebRTC, and Telroi Voice / Asterisk (SIP.js over WebSocket).")
open(p,'w').write(s); print("✓ useVoiceCall.ts")
PY

# 4. sipWsServer runtime config
python3 - << 'PY'
p='nuxt.config.ts'; s=open(p).read()
import re
if 'sipWsServer' not in s:
    s=re.sub(r"(public:\s*\{)", r"\1\n      sipWsServer: process.env.SIP_WS_SERVER || '',", s, count=1)
    open(p,'w').write(s); print("✓ nuxt.config.ts")
else: print("• sipWsServer already present")
PY

echo ""
echo "Now: npx nuxi build"
