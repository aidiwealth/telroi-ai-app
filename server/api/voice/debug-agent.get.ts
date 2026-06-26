import { requireTenant } from '~/server/utils/api';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const steps: any[] = [];
  const time = async (name: string, fn: () => Promise<any>) => {
    const t0 = Date.now();
    try { const r = await fn(); steps.push({ name, ms: Date.now()-t0, ok: true, result: typeof r === 'object' ? JSON.stringify(r).slice(0,120) : String(r).slice(0,120) }); }
    catch (e: any) { steps.push({ name, ms: Date.now()-t0, ok: false, error: (e?.name||'')+': '+(e?.message||'').slice(0,120) }); }
  };

  await time('resolveLiveCallProvider', async () => {
    const { resolveLiveCallProvider } = await import('~/server/utils/live-call-provider');
    const d = await resolveLiveCallProvider({ tenantId: s.tenantId, configuredProvider: 'auto' });
    return d.provider;
  });

  await time('agentProvision_POST', async () => {
    const { agentProvision } = await import('~/server/utils/provision-agent');
    const r = await agentProvision(s.tenantId, 'debug-test', true);
    return r.username;
  });

  return { tenantId: s.tenantId, steps };
});
