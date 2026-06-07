// GET /api/admin/billing/status -> operational view of recurring billing &
// channels for the operator. Does NOT set prices (that's /admin/pricing) — it
// shows the live STATE: what's due, what's suspended, channel capacity/usage
// per client, and when billing last ran. Read-only.
import { and, eq, lte, ne, inArray, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const now = new Date();

  // Subscriptions due for billing + suspended ones.
  const dueRows = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.status, 'active'), lte(schema.numberSubscriptions.nextBillingAt, now)));
  const suspendedRows = await db.select().from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.status, 'suspended'));

  // Plan fees due.
  const planDue = await db.select({ id: schema.tenants.id }).from(schema.tenants)
    .where(and(eq(schema.tenants.isInternal, false), lte(schema.tenants.planNextBillingAt, now)));

  // Per-client channel capacity (sum of active subscription channels) + a count
  // of live calls so the operator can see who's near capacity.
  const capByTenant = await db.select({
    tenantId: schema.numberSubscriptions.tenantId,
    capacity: sql<number>`COALESCE(SUM(${schema.numberSubscriptions.channels}),0)`
  }).from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.status, 'active'))
    .groupBy(schema.numberSubscriptions.tenantId);

  // Last billing run (most recent number_monthly or plan_fee ledger row).
  const [lastRun] = await db.select({ at: schema.ledger.createdAt })
    .from(schema.ledger)
    .where(sql`${schema.ledger.reason} IN ('number_monthly','plan_fee')`)
    .orderBy(sql`${schema.ledger.createdAt} DESC`).limit(1);

  // Resolve tenant names for the capacity table.
  const tenantIds = capByTenant.map((c) => c.tenantId);
  const names = tenantIds.length
    ? await db.select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, isInternal: schema.tenants.isInternal })
        .from(schema.tenants).where(inArray(schema.tenants.id, tenantIds))
    : [];
  const nameById = new Map(names.map((n) => [n.id, n]));

  return {
    now: now.toISOString(),
    lastRunAt: lastRun?.at || null,
    numbers: {
      dueCount: dueRows.length,
      suspendedCount: suspendedRows.length,
      suspended: suspendedRows.map((r) => ({ telnum: r.telnum, channels: r.channels, region: r.region, provider: r.provider }))
    },
    plans: { dueCount: planDue.length },
    channels: capByTenant
      .map((c) => ({ tenantId: c.tenantId, name: nameById.get(c.tenantId)?.name || '—', slug: nameById.get(c.tenantId)?.slug, isInternal: nameById.get(c.tenantId)?.isInternal || false, capacity: Number(c.capacity) }))
      .filter((c) => !c.isInternal)
      .sort((a, b) => b.capacity - a.capacity)
  };
});
