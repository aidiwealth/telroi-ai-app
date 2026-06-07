// PATCH /api/account/profile { name } -> update the signed-in user's display name.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireUser, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ name: z.string().max(120).optional() });

export default defineEventHandler(async (event) => {
  const s = await requireUser(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid name');
  const db = useDb();
  await db.update(schema.users).set({ name: p.data.name ?? null }).where(eq(schema.users.id, s.userId));
  return { ok: true };
});
