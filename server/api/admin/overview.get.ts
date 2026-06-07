// GET /api/admin/overview -> site-wide metrics for the operator dashboard.
// Aggregates across ALL tenants: workspaces, plans, calls (today + 14-day trend),
// numbers, wallet float, and credited revenue.
import { sql, gte, eq, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const days14 = new Date(now.getTime() - 13 * 86400000); days14.setHours(0, 0, 0, 0);

  // Workspaces + plan breakdown.
  const tenants = await db.select({
    id: schema.tenants.id, plan: schema.tenants.plan,
    trialPlan: schema.tenants.trialPlan, trialEndsAt: schema.tenants.trialEndsAt,
    createdAt: schema.tenants.createdAt,
    country: schema.tenants.country, sector: schema.tenants.sector
  }).from(schema.tenants);

  // Country + sector distributions for the demographic pie charts.
  const countries: Record<string, number> = {};
  const sectors: Record<string, number> = {};
  for (const t of tenants) {
    const c = t.country || 'Unknown';
    const s = t.sector || 'Unknown';
    countries[c] = (countries[c] || 0) + 1;
    sectors[s] = (sectors[s] || 0) + 1;
  }

  const planCounts = { startup: 0, growth: 0, custom: 0, trialing: 0 };
  for (const t of tenants) {
    const onTrial = t.trialPlan && t.trialEndsAt && new Date(t.trialEndsAt).getTime() > now.getTime();
    if (onTrial) planCounts.trialing++;
    planCounts[(t.plan as 'startup' | 'growth' | 'custom') || 'startup']++;
  }
  const newThisWeek = tenants.filter((t) => t.createdAt && new Date(t.createdAt).getTime() > now.getTime() - 7 * 86400000).length;

  // Calls today (site-wide).
  const [callsToday] = await db.select({
    total: sql<number>`count(*)::int`,
    inbound: sql<number>`count(*) filter (where ${schema.callEvents.direction} = 'in')::int`,
    outbound: sql<number>`count(*) filter (where ${schema.callEvents.direction} = 'out')::int`,
    missed: sql<number>`count(*) filter (where ${schema.callEvents.status} = 'missed')::int`
  }).from(schema.callEvents).where(gte(schema.callEvents.createdAt, startOfToday));

  // 14-day call volume trend (per day).
  const trendRows = await db.select({
    day: sql<string>`to_char(date_trunc('day', ${schema.callEvents.createdAt}), 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`
  }).from(schema.callEvents)
    .where(gte(schema.callEvents.createdAt, days14))
    .groupBy(sql`date_trunc('day', ${schema.callEvents.createdAt})`)
    .orderBy(sql`date_trunc('day', ${schema.callEvents.createdAt})`);

  // Fill any missing days with 0 so the chart has 14 points.
  const byDay = new Map(trendRows.map((r) => [r.day, r.count]));
  const trend: { day: string; count: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(days14.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    trend.push({ day: key, count: byDay.get(key) || 0 });
  }

  // Numbers in service + inventory available.
  const [numSold] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.status, 'active'));
  const [numAvail] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.numberInventory).where(eq(schema.numberInventory.status, 'available'));

  // Wallet float (sum of balances) by currency.
  const floatRows = await db.select({
    currency: schema.wallets.currency,
    total: sql<number>`coalesce(sum(${schema.wallets.balanceMinor}),0)::bigint`
  }).from(schema.wallets).groupBy(schema.wallets.currency);
  const walletFloat: Record<string, number> = {};
  for (const r of floatRows) walletFloat[r.currency] = Number(r.total);

  // Revenue: credited payments, last 30 days, by currency.
  const since30 = new Date(now.getTime() - 30 * 86400000);
  const revRows = await db.select({
    currency: schema.payments.currency,
    total: sql<number>`coalesce(sum(${schema.payments.amountMinor}),0)::bigint`
  }).from(schema.payments)
    .where(and(eq(schema.payments.status, 'succeeded'), gte(schema.payments.createdAt, since30)))
    .groupBy(schema.payments.currency);
  const revenue30: Record<string, number> = {};
  for (const r of revRows) revenue30[r.currency] = Number(r.total);

  // Compliance pending (operator action queue).
  const [pendingKyc] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.compliance).where(eq(schema.compliance.status, 'pending'));

  return {
    workspaces: { total: tenants.length, newThisWeek, plans: planCounts },
    callsToday: callsToday || { total: 0, inbound: 0, outbound: 0, missed: 0 },
    trend,
    numbers: { active: numSold?.c || 0, available: numAvail?.c || 0 },
    walletFloat,
    revenue30,
    pendingKyc: pendingKyc?.c || 0,
    countries,
    sectors
  };
});
