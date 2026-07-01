// POST /api/voice/block-anonymous { on: boolean } -> toggle the anonymous block.
// When on, inbound calls with no caller-id are rejected (enforced in the PBX
// control-app via the per-tenant cache; takes effect on the next cache refresh).
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const body = await readBody(event).catch(() => ({}));
  const on = !!body?.on;
  await useDb().update(schema.tenants).set({ blockAnonymous: on }).where(eq(schema.tenants.id, s.tenantId));
  return { state: on };
});
