import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  status: z.enum(['investigating','identified','monitoring','resolved']).default('investigating'),
  impact: z.enum(['none','minor','major','critical','maintenance']).default('minor'),
  body: z.string().optional(),
  affected: z.array(z.string()).optional(),
  resolved: z.boolean().optional()
});
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid');
  const db = useDb(); const d = p.data;
  const resolvedAt = (d.status === 'resolved' || d.resolved) ? new Date() : null;
  const values: any = { title: d.title, status: d.status, impact: d.impact, body: d.body || null, affected: d.affected || [], resolvedAt };
  if (d.id) { await db.update(schema.statusIncidents).set(values).where(eq(schema.statusIncidents.id, d.id)); return { ok: true, id: d.id }; }
  const [r] = await db.insert(schema.statusIncidents).values(values).returning({ id: schema.statusIncidents.id });
  return { ok: true, id: r.id };
});
