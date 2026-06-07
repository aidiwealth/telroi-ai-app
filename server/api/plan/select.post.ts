// POST /api/plan/select { plan: 'startup'|'growth' }
// Signup plan choice. BOTH plans begin with a trial (admin-set length, default 7
// days); the trial reverts to startup when it lapses. A card is collected at
// signup and charged $0 until the trial ends.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ plan: z.enum(['startup', 'growth']) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Choose a plan');
  const db = useDb();

  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const days = t?.trialDays ?? 7;
  const ends = new Date(); ends.setDate(ends.getDate() + days);

  // Both Startup and Growth start a trial of the chosen plan. The first plan-fee
  // charge is anchored to the trial end (the billing cron charges from then on).
  await db.update(schema.tenants).set({
    plan: 'startup',                 // base falls back to startup when trial lapses
    trialPlan: p.data.plan,          // the plan being trialed (startup or growth)
    trialEndsAt: ends, planSelected: true,
    planNextBillingAt: ends          // first plan fee bills when the trial ends
  }).where(eq(schema.tenants.id, s.tenantId));

  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'plan.trial_started', summary: `${p.data.plan} trial started (${days}d)` });
  return { ok: true, plan: p.data.plan, trial: { daysLeft: days } };
});
