// GET /api/voice/queue -> callers waiting for this workspace.
// The queue lives in the control-app's memory, so this asks it and passes the
// answer on. Used by the agent dashboard to show who's holding.
import { requireTenant } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const cfg = useRuntimeConfig() as any;
  const url = (cfg.provisionAgentUrl || '').replace(/\/+$/, '');
  const secret = cfg.provisionAgentSecret || '';
  if (!url || !secret) return { waiting: [] };
  try {
    const res = await fetch(`${url}/queue?tenantId=${encodeURIComponent(s.tenantId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { waiting: [] };
    const j = await res.json() as any;
    return { waiting: j.waiting || [] };
  } catch {
    // A queue we can't reach is better shown as empty than as an error the agent
    // can do nothing about.
    return { waiting: [] };
  }
});
