// GET /api/admin/clients[?page=&pageSize=&q=] -> paginated workspace list with
// per-tenant counts aggregated IN SQL (GROUP BY), not by loading every child
// row into memory. Scales to large numbers of clients without slow loads.
import { inArray, sql, desc, ilike, or, and, eq, count } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { OperatorClient } from '~/server/utils/telroi/operator';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const q = getQuery(event);

  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 100);
  const search = (q.q as string || '').trim();

  // Filter: exclude internal workspaces; optional name/slug search.
  const where: any[] = [eq(schema.tenants.isInternal, false)];
  if (search) where.push(or(ilike(schema.tenants.name, `%${search}%`), ilike(schema.tenants.slug, `%${search}%`)));

  // Total for pagination (cheap COUNT).
  const [{ total }] = await db.select({ total: count() }).from(schema.tenants).where(and(...where));

  // One page of tenants.
  const tenants = await db.select().from(schema.tenants)
    .where(and(...where))
    .orderBy(desc(schema.tenants.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  const tenantIds = tenants.map((t) => t.id);

  // Per-tenant counts via GROUP BY — one small query per table, only for the
  // tenants on this page. Returns aggregates, never the underlying rows.
  async function counts(table: any, col: any) {
    if (!tenantIds.length) return new Map<string, number>();
    const rows = await db.select({ tid: col, n: count() }).from(table)
      .where(inArray(col, tenantIds)).groupBy(col);
    return new Map(rows.map((r: any) => [r.tid, Number(r.n)]));
  }
  const [vanC, flowC, aiC, carrierC, numC] = await Promise.all([
    counts(schema.vans, schema.vans.tenantId),
    counts(schema.connectFlows, schema.connectFlows.tenantId),
    counts(schema.aiConnections, schema.aiConnections.tenantId),
    counts(schema.voiceProviders, schema.voiceProviders.tenantId),
    counts(schema.numberSubscriptions, schema.numberSubscriptions.tenantId)
  ]);
  const wallets = tenantIds.length
    ? await db.select().from(schema.wallets).where(inArray(schema.wallets.tenantId, tenantIds))
    : [];
  const walletByTid = new Map(wallets.map((w) => [w.tenantId, w]));

  let provisioned = new Set<string>();
  try {
    const op = await OperatorClient.fromPlatform();
    provisioned = new Set(await op.listDomains());
  } catch { /* operator unreachable — DB list still complete */ }

  const now = Date.now();
  const clients = tenants.map((t) => {
    const tid = t.id;
    const vanCount = vanC.get(tid) || 0;
    const flowCount = flowC.get(tid) || 0;
    const aiCount = aiC.get(tid) || 0;
    const carrierCount = carrierC.get(tid) || 0;
    const numCount = numC.get(tid) || 0;
    const wallet = walletByTid.get(tid);
    const trialActive = !!(t.trialPlan && t.trialEndsAt && new Date(t.trialEndsAt).getTime() > now);
    const effectivePlan = trialActive ? (t.trialPlan as string) : (t.plan as string);
    return {
      tenantId: tid, name: t.name, slug: t.slug,
      domain: t.telroiDomain || `${t.slug}.telroi.ai`,
      createdAt: t.createdAt,
      provisioned: t.telroiDomain ? provisioned.has(t.telroiDomain) : false,
      plan: effectivePlan, basePlan: t.plan, onTrial: trialActive,
      sandbox: t.sandboxMode,
      walletMinor: wallet?.balanceMinor ?? 0, walletCurrency: wallet?.currency ?? 'USD',
      products: { one: true, van: vanCount > 0, connect: flowCount > 0, optimize: true, carrierGrade: carrierCount > 0, ai: aiCount > 0 },
      counts: { vans: vanCount, flows: flowCount, ai: aiCount, carriers: carrierCount, numbers: numCount }
    };
  });

  return { clients, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
});
