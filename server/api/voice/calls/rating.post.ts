// POST /api/voice/calls/rating { callUid, rating?, note? }
// Upserts the caller's rating/note for a specific call (keyed by PBX call uid).
// rating null clears it. This is a real, persisted feature owned by Telroi
// (the PBX call history is read-only for ratings).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  callUid: z.string().min(1),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().max(1000).nullable().optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'callUid and a 1–5 rating (or note) are required');
  const db = useDb();

  const [existing] = await db.select().from(schema.callRatings)
    .where(and(eq(schema.callRatings.tenantId, s.tenantId), eq(schema.callRatings.callUid, p.data.callUid)))
    .limit(1);

  const patch: any = { updatedAt: new Date() };
  if (p.data.rating !== undefined) patch.rating = p.data.rating;
  if (p.data.note !== undefined) patch.note = p.data.note;

  if (existing) {
    await db.update(schema.callRatings).set(patch).where(eq(schema.callRatings.id, existing.id));
  } else {
    await db.insert(schema.callRatings).values({
      tenantId: s.tenantId, callUid: p.data.callUid,
      rating: p.data.rating ?? null, note: p.data.note ?? null,
      ratedByUserId: s.userId
    });
  }
  return { ok: true, callUid: p.data.callUid, rating: p.data.rating ?? existing?.rating ?? null, note: p.data.note ?? existing?.note ?? null };
});
