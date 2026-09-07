// POST /api/voice/calls/seen
//
// Marks this person as having looked at their missed calls.
//
// Per user rather than per workspace: a count driven by colleagues' missed
// calls is one people learn to ignore, which is worse than not having it at
// all. Somebody who has dealt with theirs should see zero even while the
// workspace's own total is higher.
import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const now = new Date();

  // Now rather than a timestamp the caller supplies: a client clock that is
  // wrong by an hour would hide calls or resurrect old ones, and the moment
  // that matters is when the request arrived.
  const [existing] = await db.select().from(schema.missedSeen)
    .where(and(eq(schema.missedSeen.tenantId, s.tenantId),
               eq(schema.missedSeen.userId, s.userId))).limit(1);

  if (existing) {
    await db.update(schema.missedSeen).set({ seenAt: now })
      .where(and(eq(schema.missedSeen.tenantId, s.tenantId),
                 eq(schema.missedSeen.userId, s.userId)));
  } else {
    await db.insert(schema.missedSeen)
      .values({ tenantId: s.tenantId, userId: s.userId, seenAt: now });
  }
  return { ok: true, seenAt: now };
});
