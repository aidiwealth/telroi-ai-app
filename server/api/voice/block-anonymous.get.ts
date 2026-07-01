// GET /api/voice/block-anonymous -> current state of the anonymous-call block.
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const [t] = await useDb().select({ on: schema.tenants.blockAnonymous })
    .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  return { state: !!t?.on };
});
