// GET /api/admin/pbx-logs?after=<seq> -> proxies the control-app's in-memory
// log ring buffer to the admin live-log viewer. Superadmin-only. The browser
// never talks to the droplet directly; this forwards with the internal bearer
// secret, so the PBX log endpoint stays private.
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const cfg = useRuntimeConfig() as any;
  const url = cfg.provisionAgentUrl || '';
  const secret = cfg.provisionAgentSecret || '';
  if (!url || !secret) throw apiError('not_configured', 'PBX log endpoint is not configured', 503);

  const after = Number(getQuery(event).after || '0') || 0;
  try {
    const res = await $fetch<any>(`${url}/logs`, {
      query: { after },
      headers: { Authorization: `Bearer ${secret}` },
      timeout: 5000
    });
    return res;
  } catch (e: any) {
    throw apiError('pbx_unreachable', `Could not reach the PBX log service: ${e?.message || e}`, 502);
  }
});
