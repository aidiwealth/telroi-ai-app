// POST /api/admin/support/calls/rating { callUid, rating?, note? }
//
// The same rating the client sets on their own calls, for the support
// workspace. Attributed through userIdForAdmin because rated_by_user_id
// references users and an operator's platform-admin id is not one — writing it
// raw would either violate the key or point at nothing.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin, userIdForAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  callUid: z.string().min(1),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().max(1000).nullable().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'callUid and a 1-5 rating (or note) are required');
  const db = useDb();

  const [existing] = await db.select().from(schema.callRatings)
    .where(and(eq(schema.callRatings.tenantId, ws.tenantId),
               eq(schema.callRatings.callUid, p.data.callUid))).limit(1);

  const patch: any = { updatedAt: new Date() };
  if (p.data.rating !== undefined) patch.rating = p.data.rating;
  if (p.data.note !== undefined) patch.note = p.data.note;

  if (existing) {
    await db.update(schema.callRatings).set(patch).where(eq(schema.callRatings.id, existing.id));
  } else {
    // Null rather than a wrong id if the operator has no user record: an
    // unattributed rating is worth more than a failed one.
    const uid = await userIdForAdmin(String((admin as any).id)).catch(() => null);
    await db.insert(schema.callRatings).values({
      tenantId: ws.tenantId, callUid: p.data.callUid,
      rating: p.data.rating ?? null, note: p.data.note ?? null,
      ratedByUserId: uid || null
    });
  }
  return { ok: true, callUid: p.data.callUid,
           rating: p.data.rating ?? existing?.rating ?? null,
           note: p.data.note ?? existing?.note ?? null };
});
