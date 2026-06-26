#!/usr/bin/env bash
# Step 1 (web-app side): wire telroi outbound to Asterisk via the control-app agent.
# Run from repo root on `refactor-asterisk-backbone`, AFTER Phase 1 + Option 3 committed.
# Then: npx nuxi build → green → commit.
set -e
cd "$(git rev-parse --show-toplevel)"

# 1. Add agentOriginate() to the provisioning-agent HTTP wrapper
python3 - << 'PY'
p='server/utils/provision-agent.ts'; s=open(p).read()
if 'agentOriginate' not in s:
    s=s.rstrip()+'''

export interface AgentOriginateResult {
  callid: string;
  agentChannelId: string;
}

// Originate a click-to-call via the PBX agent: ring `agentEndpoint` (the agent's
// registered device, e.g. "PJSIP/tnt_xxx"), then dial `to` out through `trunk`
// (an Asterisk trunk endpoint, e.g. "kasooko-endpoint") and bridge them.
export async function agentOriginate(args: {
  agentEndpoint: string; to: string; trunk: string; callerId?: string;
}): Promise<AgentOriginateResult> {
  const j = await agentCall('/originate', args);
  return { callid: j.callid, agentChannelId: j.agentChannelId };
}
'''
    open(p,'w').write(s); print("✓ provision-agent.ts")
else: print("• provision-agent.ts already has agentOriginate")
PY

# 2. telroiFor → AsteriskClient for live tenants
python3 - << 'PY'
p='server/utils/tenant.ts'; s=open(p).read()
s=s.replace(
"""  const isLive = !tenant.sandboxMode && tenant.provisionState === 'provisioned' && tenant.telroiDomain && tenant.telroiApiKeyEnc;
  if (!isLive) {
    const { SandboxTelroiClient } = await import('./telroi/sandbox-client');
    return new SandboxTelroiClient(tenantId) as any;
  }
  return TelroiClient.forTenant(tenant);""",
"""  const isLive = !tenant.sandboxMode && tenant.provisionState === 'provisioned';
  if (!isLive) {
    const { SandboxTelroiClient } = await import('./telroi/sandbox-client');
    return new SandboxTelroiClient(tenantId) as any;
  }
  const { AsteriskClient } = await import('./telroi/asterisk-client');
  return AsteriskClient.forTenant(tenant) as any;""")
if 'TelroiClient.forTenant' not in s and 'new TelroiClient' not in s:
    s=s.replace("import { TelroiClient } from './telroi/client';\n","")
open(p,'w').write(s); print("✓ tenant.ts")
PY

# 3. placeCall telroi branch → AsteriskClient
python3 - << 'PY'
p='server/utils/call-router.ts'; s=open(p).read()
old="""    case 'telroi': {
      // Telroi's OWN Digitide PBX (master subdomain + key) — its own route.
      if (!master.telroiPbx) throw apiError('no_carrier', 'Telroi PBX is not configured', 503);
      const client = new TelroiClient({ domain: master.telroiPbx.domain, apiKey: master.telroiPbx.apiKey });
      return await client.makeCall({ phone: args.to, user: args.user, group: args.group, clid: args.fromTelnum });
    }"""
new="""    case 'telroi': {
      // Telroi Voice — our OWN Asterisk PBX. Origination runs via the control-app
      // agent (rings the agent's device, dials the destination out through the
      // region's trunk, bridges them).
      const { AsteriskClient } = await import('./telroi/asterisk-client');
      const client = AsteriskClient.forTenant({ id: args.tenantId });
      return await client.makeCall({ phone: args.to, user: args.user, group: args.group, clid: args.fromTelnum });
    }"""
if old in s:
    s=s.replace(old,new)
    if 'TelroiClient' not in s.replace("import { TelroiClient }",""):
        s=s.replace("import { TelroiClient } from './telroi/client';\n","")
    open(p,'w').write(s); print("✓ call-router.ts")
else: print("• call-router telroi branch already updated or differs")
PY

echo ""
echo "NOTE: also create server/utils/telroi/asterisk-client.ts (provided separately)."
echo "Then: npx nuxi build"
