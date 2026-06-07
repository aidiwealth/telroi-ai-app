// POST /api/keys { name, mode } -> mint a new API key. Raw key shown ONCE.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { sha256, randomToken, last4 } from '~/server/utils/crypto';

const Body = z.object({ name: z.string().min(1), mode: z.enum(['live', 'test']).default('live') });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Key name required');

  const prefix = `tlr_${p.data.mode}`;
  const secret = randomToken(24).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const raw = `${prefix}_${secret}`;
  const db = useDb();
  const [row] = await db.insert(schema.apiKeys).values({
    tenantId: s.tenantId, name: p.data.name, prefix,
    keyHash: sha256(raw), last4: last4(raw), scopes: ['*']
  }).returning();

  // Raw key returned ONLY here — never retrievable again.
  return { id: row.id, name: row.name, key: raw, masked: `${prefix}_••••${row.last4}` };
});
