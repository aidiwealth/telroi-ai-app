#!/usr/bin/env bash
# Fix the /api/voice/token 504 hang: token no longer blocks indefinitely.
# - agentCall gets a 12s timeout (no infinite hang)
# - asteriskVoiceToken is a pure DB read
# - token endpoint provisions the webrtc endpoint ONCE (timed), then pure-reads
# Run from repo root on main. Then: npx nuxi build -> commit -> push.
set -e
cd "$(git rev-parse --show-toplevel)"

# 1. provision-agent: timeout + ensureWebrtcEndpoint
python3 - << 'PY'
p='server/utils/provision-agent.ts'; s=open(p).read()
old="""  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body)
  });"""
new="""  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });"""
if old in s: s=s.replace(old,new); print("✓ agentCall timeout")
else: print("• agentCall timeout already / differs")
if 'ensureWebrtcEndpoint' not in s:
    s=s.rstrip()+'''

export async function ensureWebrtcEndpoint(tenantId: string): Promise<{ created: boolean; sipUsername: string }> {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq } = await import('drizzle-orm');
  const { encrypt } = await import('~/server/utils/crypto');
  const db = useDb();
  const rows = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, tenantId), eq(schema.sipEndpoints.provider, 'telroi')));
  const existing = rows.find((r: any) => (r.meta as any)?.webrtc === true && r.secretEnc);
  if (existing) return { created: false, sipUsername: existing.sipUsername! };
  const result = await agentProvision(tenantId, 'browser-dialer', true);
  await db.insert(schema.sipEndpoints).values({
    tenantId, provider: 'telroi', kind: 'registration',
    externalId: result.username, label: 'browser-dialer', sipUsername: result.username,
    secretEnc: encrypt(result.password), domain: result.domain,
    meta: { transport: result.transport, webrtc: true }
  });
  return { created: true, sipUsername: result.username };
}
'''
    print("✓ ensureWebrtcEndpoint")
else: print("• ensureWebrtcEndpoint already present")
open(p,'w').write(s)
PY

# 2. asteriskVoiceToken: pure DB read
python3 - << 'PY'
import re
p='server/utils/voice-token.ts'; s=open(p).read()
m=re.search(r"export async function asteriskVoiceToken\([^)]*\)[^{]*\{.*?\n\}\n", s, re.S)
assert m, "asteriskVoiceToken not found"
new='''export async function asteriskVoiceToken(identity: string) {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq } = await import('drizzle-orm');
  const { decrypt } = await import('~/server/utils/crypto');
  const mm = /^tenant_([0-9a-f-]+)_/.exec(identity);
  const tenantId = mm ? mm[1] : identity;
  const db = useDb();
  const rows = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, tenantId), eq(schema.sipEndpoints.provider, 'telroi')));
  const ep = rows.find((r: any) => (r.meta as any)?.webrtc === true && r.secretEnc);
  if (!ep) {
    throw Object.assign(new Error('Browser calling is not set up yet for this workspace.'), {
      statusCode: 409, data: { error: { code: 'webrtc_not_provisioned' } }
    });
  }
  const sipDomain = process.env.SIP_DOMAIN || 'sip.telroi.ai';
  const wsServer = (useRuntimeConfig().public as any)?.sipWsServer || `wss://${sipDomain}:8089/ws`;
  return { provider: 'telroi', sipUsername: ep.sipUsername, sipPassword: decrypt(ep.secretEnc!), sipDomain, wsServer };
}
'''
s=s.replace(m.group(0), new)
s=s.replace("if (provider === 'telroi' || provider === 'asterisk') return await asteriskVoiceToken();",
            "if (provider === 'telroi' || provider === 'asterisk') return await asteriskVoiceToken(identity);")
open(p,'w').write(s); print("✓ asteriskVoiceToken pure DB read")
PY

# 3. token endpoint: ensure (timed) then mint
python3 - << 'PY'
p='server/api/voice/token.post.ts'; s=open(p).read()
old="""  const dial = await resolveLiveCallProvider({ tenantId: s.tenantId, configuredProvider: 'auto' });
  try {
    const tok = await voiceTokenFor(dial.provider, `tenant_${s.tenantId}_${s.userId}`);"""
new="""  const dial = await resolveLiveCallProvider({ tenantId: s.tenantId, configuredProvider: 'auto' });
  if (dial.provider === 'telroi') {
    try {
      const { ensureWebrtcEndpoint } = await import('~/server/utils/provision-agent');
      await ensureWebrtcEndpoint(s.tenantId);
    } catch (e: any) {
      throw apiError('voice_not_configured', e?.message || 'Browser calling could not be set up. Try again.', 503);
    }
  }
  try {
    const tok = await voiceTokenFor(dial.provider, `tenant_${s.tenantId}_${s.userId}`);"""
assert old in s, "token handler not found"
s=s.replace(old,new); open(p,'w').write(s); print("✓ token endpoint timed-ensure")
PY

echo ""
echo "Now: npx nuxi build"
