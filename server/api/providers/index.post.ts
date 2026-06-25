// POST /api/providers { kind, credentials } -> encrypt + store carrier creds.
// Tests the credentials before saving so a bad key fails fast.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';
import { testProvider } from '~/server/utils/providers';

const Body = z.object({
  kind: z.enum(['twilio', 'telnyx']),
  credentials: z.record(z.any())
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'kind and credentials required');

  const test = await testProvider(p.data.kind, p.data.credentials);
  const db = useDb();
  const [row] = await db.insert(schema.voiceProviders).values({
    tenantId: s.tenantId,
    kind: p.data.kind,
    credentialsEnc: encrypt(JSON.stringify(p.data.credentials)),
    status: test.ok ? 'ok' : 'failed'
  }).returning();
  return { id: row.id, kind: row.kind, status: row.status, test };
});
