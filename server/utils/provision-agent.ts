// server/utils/provision-agent.ts
// Client for the Telroi PBX provisioning agent (an authenticated HTTP service
// running inside the control app ON the Asterisk box). The web app can't touch
// the PBX directly, so it calls this agent to provision/deprovision SIP
// endpoints on Asterisk (config-generation: write pjsip.d file + reload).
//
// Config from runtimeConfig:
//   provisionAgentUrl    — e.g. https://sip.telroi.ai:8443
//   provisionAgentSecret — shared secret (Bearer), matches the agent's PBX env.

export interface AgentProvisionResult {
  username: string;
  password: string;
  domain: string;
  transport: string;
  context: string;
  configPath: string;
}

function agentConfig() {
  const cfg = useRuntimeConfig();
  const url = (cfg.provisionAgentUrl || '').replace(/\/+$/, '');
  const secret = cfg.provisionAgentSecret || '';
  return { url, secret };
}

export function provisionAgentConfigured(): boolean {
  const { url, secret } = agentConfig();
  return !!(url && secret);
}

async function agentCall(path: string, body: unknown): Promise<any> {
  const { url, secret } = agentConfig();
  if (!url || !secret) throw new Error('Provisioning agent not configured');
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(`Provisioning agent ${path} failed: HTTP ${res.status} ${json?.error || ''}`.trim());
  }
  return json;
}

export async function agentProvision(tenantId: string, label: string): Promise<AgentProvisionResult> {
  const j = await agentCall('/provision', { tenantId, label });
  return {
    username: j.username, password: j.password, domain: j.domain,
    transport: j.transport, context: j.context, configPath: j.configPath
  };
}

export async function agentDeprovision(username: string): Promise<{ removed: boolean }> {
  const j = await agentCall('/deprovision', { username });
  return { removed: !!j.removed };
}

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
