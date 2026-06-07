import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({ provider: z.enum(['zapier', 'pipedrive', 'hubspot', 'zoho']) });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A provider is required');
  const db = useDb();
  await db.delete(schema.integrations).where(and(eq(schema.integrations.tenantId, s.tenantId), eq(schema.integrations.provider, p.data.provider)));
  const { logEvent } = await import('~/server/utils/logs');
  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'integration.disconnect', summary: `Disconnected ${p.data.provider}` });
  return { ok: true };
});
