// POST /api/tenant/provision-telroi  { domain, apiKey } -> store encrypted Telroi creds
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';

const Body = z.object({ domain: z.string().min(3), apiKey: z.string().min(8) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Telroi domain and API key required');
  const db = useDb();
  await db.update(schema.tenants)
    .set({ telroiDomain: parsed.data.domain, telroiApiKeyEnc: encrypt(parsed.data.apiKey) })
    .where(eq(schema.tenants.id, s.tenantId));
  return { ok: true, provisioned: true };
});
