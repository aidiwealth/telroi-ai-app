// GET /api/integrations -> connection status + sync state for each provider,
// plus the tenant's embed bridge key (used by the in-CRM panel).
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.tenantId, s.tenantId));
  const byProvider: Record<string, any> = {};
  for (const r of rows) byProvider[r.provider] = {
    status: r.status, connectedAt: r.connectedAt, lastSyncedAt: r.lastSyncedAt,
    modeEmbed: r.modeEmbed, modeImport: r.modeImport,
    lastImportAt: r.lastImportAt, importedCount: r.importedCount, lastSyncError: r.lastSyncError
  };
  const [t] = await db.select({ widgetKey: schema.tenants.widgetKey }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  return { connections: byProvider, bridgeKey: t?.widgetKey || null };
});

