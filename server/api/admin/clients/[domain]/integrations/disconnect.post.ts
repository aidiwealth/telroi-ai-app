// POST /api/admin/clients/:domain/integrations/disconnect { provider }
// Operator disconnects an integration on the client's behalf (support action).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
const Body = z.object({ provider: z.enum(['zapier', 'pipedrive', 'hubspot', 'zoho']) });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'provider required');
  const db = useDb();
  await db.delete(schema.integrations).where(and(eq(schema.integrations.tenantId, t.id), eq(schema.integrations.provider, p.data.provider)));
  return { ok: true };
});
