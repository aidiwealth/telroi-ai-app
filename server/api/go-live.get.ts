// GET /api/go-live
// What the client needs to render their go-live state: whether they're live,
// where compliance stands, and how much sandbox allowance is left.
import { requireTenant } from '~/server/utils/api';
import { goLiveState } from '~/server/utils/go-live';
import { sandboxStatus } from '~/server/utils/sandbox-limits';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const [live, sandbox] = await Promise.all([
    goLiveState(s.tenantId),
    sandboxStatus(s.tenantId)
  ]);

  // Real prices, in the client's own currency. Asking someone to commit to being
  // billed without showing what it costs would be a poor way to treat them.
  const { useDb, schema } = await import('~/server/db');
  const { eq } = await import('drizzle-orm');
  const db = useDb();
  const [pr] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const [tenant] = await db.select({ country: schema.tenants.country })
    .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  const ngn = (tenant?.country || '').toLowerCase() === 'nigeria';
  const rate = pr?.ngnPerUsd || 1600;
  const conv = (usdMinor: number) => (ngn ? usdMinor * rate : usdMinor);

  const pricing = pr ? {
    currency: ngn ? 'NGN' : 'USD',
    plans: {
      startup: conv(pr.planStartupUsdMinor),
      growth: conv(pr.planGrowthUsdMinor)
    },
    usage: {
      voiceMinute: conv(pr.voiceMinuteUsdMinor),
      channelMonthly: conv(pr.channelMonthlyUsdMinor),
      didMonthly: conv(pr.didMonthlyUsdMinor)
    }
  } : null;

  // Days left on a trial, if one is running. Going live keeps it, so the client
  // should be told their plan starts then rather than now.
  const { trialActive, trialDaysLeft } = await import('~/server/utils/entitlements');
  const [full] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const trial = full && trialActive(full as any)
    ? { endsAt: full.trialEndsAt, daysLeft: trialDaysLeft(full as any) }
    : null;

  // The demo number this workspace can test on, chosen by country. Returned
  // here because a client refused a purchase needs to know what they can still
  // do — a gate that only says no is a reason to give up.
  const { platformSettings } = await import('~/server/utils/platform');
  const ps: any = await platformSettings().catch(() => null);
  const [tnt] = await useDb().select({ country: schema.tenants.country })
    .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const demoNumber = (tnt?.country || '').toLowerCase() === 'nigeria'
    ? (ps?.demoNumberNg || null)
    : (ps?.demoNumberIntl || null);

  return { ...live, sandbox, pricing, trial, demoNumber };
});
