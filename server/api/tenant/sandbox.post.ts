// POST /api/tenant/sandbox { sandbox: boolean } -> set this workspace's sandbox
// mode. Server-enforced source of truth for the dashboard toggle. Going LIVE
// (sandbox=false) requires approved compliance, mirroring the existing go-live
// gate; sandbox can always be re-enabled.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ sandbox: z.boolean() });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'sandbox (boolean) required');
  const db = useDb();

  // Switching to LIVE requires approved compliance (same gate as go-live).
  if (p.data.sandbox === false) {
    const [c] = await db.select().from(schema.compliance).where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);
    if (!c || c.status !== 'approved') {
      throw apiError('compliance_required', 'Your account must be verified before going live. Submit your documents for review first.', 403);
    }
  }

  await db.update(schema.tenants).set({ sandboxMode: p.data.sandbox }).where(eq(schema.tenants.id, s.tenantId));

  // Going LIVE is the trigger to provision the country's vendor (Nigeria ->
  // Digidite account/team; elsewhere -> carrier marked ready, numbers lazy).
  // Best-effort: a provisioning hiccup doesn't block the mode switch.
  let provisioning: any = null;
  if (p.data.sandbox === false) {
    try {
      const { provisionOnGoLive } = await import('~/server/utils/provision-lifecycle');
      provisioning = await provisionOnGoLive(s.tenantId);
    } catch (e: any) { provisioning = { ok: false, reason: e?.message }; }
  }
  return { ok: true, sandbox: p.data.sandbox, provisioning };
});
