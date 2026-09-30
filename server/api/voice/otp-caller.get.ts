// GET /api/voice/otp-caller — the numbers this workspace could send OTP and
// notification calls from, and which one is chosen.
//
// Both together because the page needs both and neither is useful alone: a
// list with no current value cannot show what is set, and a value with no list
// cannot be changed.
import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  const numbers = await db.select({
    telnum: schema.numberSubscriptions.telnum,
    provider: schema.numberSubscriptions.provider
  }).from(schema.numberSubscriptions)
    .where(and(
      eq(schema.numberSubscriptions.tenantId, s.tenantId),
      eq(schema.numberSubscriptions.status, 'active')
    ));

  const [t] = await db.select({ chosen: schema.tenants.otpCallerTelnum, securityNotice: schema.tenants.otpSecurityNotice })
    .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  return { numbers, chosen: t?.chosen || null, securityNotice: t?.securityNotice !== false };
});
