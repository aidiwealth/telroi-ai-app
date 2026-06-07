// GET /api/admin/clients/:domain/integrations -> operator view of a client's
// CRM/automation integrations: which are connected, mode, sync health, and
// event subscriptions. Read + manage (operators can disconnect on behalf).
import { eq, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const db = useDb();
  const conns = await db.select({
    provider: schema.integrations.provider, status: schema.integrations.status,
    modeEmbed: schema.integrations.modeEmbed, modeImport: schema.integrations.modeImport,
    connectedAt: schema.integrations.connectedAt, lastImportAt: schema.integrations.lastImportAt,
    importedCount: schema.integrations.importedCount, lastSyncError: schema.integrations.lastSyncError
  }).from(schema.integrations).where(eq(schema.integrations.tenantId, t.id));
  const events = await db.select({
    id: schema.integrationEvents.id, provider: schema.integrationEvents.provider,
    event: schema.integrationEvents.event, active: schema.integrationEvents.active,
    lastFiredAt: schema.integrationEvents.lastFiredAt
  }).from(schema.integrationEvents).where(eq(schema.integrationEvents.tenantId, t.id)).orderBy(desc(schema.integrationEvents.createdAt));
  return { connections: conns, events };
});
