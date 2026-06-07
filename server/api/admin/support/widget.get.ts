// GET /api/admin/support/widget -> support workspace widget config + ready embed
// snippet, so staff can place the support widget on OTHER pages/sites.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { widgetConfig } from '~/server/utils/live-call';
import { useDb, schema } from '~/server/db';
import { randomBytes } from 'node:crypto';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  let [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, ws.tenantId)).limit(1);
  if (!t?.widgetKey) {
    const key = 'wgt_' + randomBytes(16).toString('hex');
    await db.update(schema.tenants).set({ widgetKey: key }).where(eq(schema.tenants.id, ws.tenantId));
    t = { ...t, widgetKey: key } as any;
  }
  const base = (useRuntimeConfig().public as any).appBaseUrl || '';
  return { config: await widgetConfig(ws.tenantId), key: t.widgetKey, base };
});
