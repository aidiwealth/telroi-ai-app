// GET /api/admin/support/queue -> callers waiting for the support desk.
// The client endpoint reads whatever tenant session exists, which for an admin
// is their own workspace rather than support's — so it reported an empty queue
// while people were holding.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const cfg = useRuntimeConfig() as any;
  const url = (cfg.provisionAgentUrl || '').replace(/\/+$/, '');
  const secret = cfg.provisionAgentSecret || '';
  if (!url || !secret) return { waiting: [] };
  try {
    const res = await fetch(`${url}/queue?tenantId=${encodeURIComponent(ws.tenantId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { waiting: [] };
    const j = await res.json() as any;
    return { waiting: j.waiting || [] };
  } catch {
    return { waiting: [] };
  }
});
