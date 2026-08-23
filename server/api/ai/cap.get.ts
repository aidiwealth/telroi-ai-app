// GET /api/ai/cap -> the daily AI ceiling and what has been spent against it.
//
// A client who only meets the cap when it bites will read it as the platform
// breaking. Showing the figure and the day's spend against it makes it a thing
// they manage rather than a thing that happens to them.
import { and, eq, gte, sql } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  const [t] = await db.select({
    cap: schema.tenants.aiDailyCapUsdMinor, tz: schema.tenants.timezone
  }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  const { getPricing } = await import('~/server/utils/pricing');
  const pricing: any = await getPricing(s.tenantId).catch(() => null);
  const platformUsdMinor = pricing?.aiDailyCapUsdMinor ?? 500;
  const capUsdMinor = t?.cap ?? platformUsdMinor;

  const [w] = await db.select({ currency: schema.wallets.currency })
    .from(schema.wallets).where(eq(schema.wallets.tenantId, s.tenantId)).limit(1);
  const currency = w?.currency || 'NGN';
  const ngnPerUsd = Number(pricing?.ngnPerUsd) || 1600;
  const capMinor = currency === 'NGN' ? Math.round(capUsdMinor * ngnPerUsd) : capUsdMinor;

  // Their midnight, not ours.
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: t?.tz || 'Africa/Lagos' }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  const since = new Date(local.getTime() + offset);

  const [row] = await db.select({ spent: sql<number>`coalesce(sum(${schema.ledger.amountMinor}), 0)` })
    .from(schema.ledger)
    .where(and(
      eq(schema.ledger.tenantId, s.tenantId),
      eq(schema.ledger.reason, 'ai_managed'),
      eq(schema.ledger.kind, 'debit'),
      gte(schema.ledger.createdAt, since)
    ));

  const spentMinor = Number(row?.spent || 0);
  return {
    currency,
    capMinor,
    spentMinor,
    // Whose figure it is, so the page can say "yours" or "the default".
    isOwn: t?.cap != null,
    unlimited: capMinor <= 0,
    reached: capMinor > 0 && spentMinor >= capMinor
  };
});
