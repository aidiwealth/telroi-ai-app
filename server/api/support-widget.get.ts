// GET /api/support-widget -> the active support widget key, so the signed-in
// client app auto-loads Telroi's own Live Call widget (replacing Intercom)
// WITHOUT any env var. Returns null until an admin has set up the support
// workspace + enabled Live Call. Safe: the key is public by design.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { platformSettings } from '~/server/utils/platform';
import { randomBytes } from 'node:crypto';
export default defineEventHandler(async (event) => {
  try {
    const settings = await platformSettings();
    if (!settings?.supportTenantId) return { key: null };
    const db = useDb();
    let [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, settings.supportTenantId)).limit(1);
    if (!t) return { key: null };
    // Generate the widget key on first read if missing.
    if (!t.widgetKey) {
      const key = 'wgt_' + randomBytes(16).toString('hex');
      await db.update(schema.tenants).set({ widgetKey: key }).where(eq(schema.tenants.id, t.id));
      t = { ...t, widgetKey: key } as any;
    }
    return { key: t.widgetKey };
  } catch {
    return { key: null };
  }
});
