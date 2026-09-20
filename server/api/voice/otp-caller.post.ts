// POST /api/voice/otp-caller { telnum }
//
// Which of the workspace's own numbers carries OTP and notification calls.
//
// Not whether to use their own number — that is ours to decide, since it
// protects everybody's traffic from one blocked line — but which one. A
// workspace with a marketing line and a support line has a clear preference
// about what a customer sees on a verification call, and no way to say so.
//
// Only a number they actually hold. Presenting somebody else's is exactly the
// spoofing carriers block for, and it would be our number that got blocked.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ telnum: z.string().min(3).nullable() });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'telnum is required, or null to clear');
  const db = useDb();

  if (p.data.telnum) {
    const [owned] = await db.select({ id: schema.numberSubscriptions.id })
      .from(schema.numberSubscriptions)
      .where(and(
        eq(schema.numberSubscriptions.tenantId, s.tenantId),
        eq(schema.numberSubscriptions.telnum, p.data.telnum),
        eq(schema.numberSubscriptions.status, 'active')
      )).limit(1);
    if (!owned) throw apiError('not_found', 'That number is not on your workspace.', 404);
  }

  await db.update(schema.tenants).set({ otpCallerTelnum: p.data.telnum })
    .where(eq(schema.tenants.id, s.tenantId));
  return { ok: true, telnum: p.data.telnum };
});
