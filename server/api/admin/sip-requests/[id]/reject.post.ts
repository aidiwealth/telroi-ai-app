// POST /api/admin/sip-requests/:id/reject { reason } -> decline, with a reason.
// A rejection without one leaves the client guessing at what to change.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ reason: z.string().min(3).max(300) });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Give a reason the client can act on');

  const db = useDb();
  const [reqRow] = await db.select().from(schema.sipIpRequests).where(eq(schema.sipIpRequests.id, id)).limit(1);
  if (!reqRow) throw apiError('not_found', 'Request not found', 404);
  if (reqRow.status !== 'pending') throw apiError('already_decided', `This request was already ${reqRow.status}.`, 409);

  await db.update(schema.sipIpRequests).set({
    status: 'rejected', decidedBy: admin.email, decidedAt: new Date(), rejectReason: p.data.reason
  }).where(eq(schema.sipIpRequests.id, id));

  await logEvent({
    tenantId: reqRow.tenantId, kind: 'system', action: 'sip.ip_rejected',
    summary: `${admin.email} declined ${reqRow.ipAddress}: ${p.data.reason}`
  });

  return { ok: true };
});
