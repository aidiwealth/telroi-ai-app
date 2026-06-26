import { requireTenant } from '~/server/utils/api';
export default defineEventHandler(async (event) => {
  await requireTenant(event);
  const cfg = useRuntimeConfig();
  const url = (cfg.provisionAgentUrl || '').replace(/\/+$/, '');
  const secret = cfg.provisionAgentSecret || '';
  const out: any = { url, hasSecret: !!secret };
  const t0 = Date.now();
  try {
    const res = await fetch(`${url}/health`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000)
    });
    out.status = res.status;
    out.ms = Date.now() - t0;
    out.body = (await res.text()).slice(0, 100);
  } catch (e: any) {
    out.error = e?.name + ': ' + e?.message;
    out.ms = Date.now() - t0;
  }
  return out;
});
