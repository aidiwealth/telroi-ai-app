// GET /api/admin/webhook-log -> what arrived from our providers, and what we
// did with it.
//
// Payment webhooks only. Call webhooks fire on every leg of every call and
// would bury this; when one of those matters, it matters to the client, and
// they have their own view under Developers.
import { desc, eq, and, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const db = useDb();

  const filters: any[] = [];
  if (q.provider) filters.push(eq(schema.webhookEvents.provider, String(q.provider)));
  if (q.outcome) filters.push(eq(schema.webhookEvents.outcome, String(q.outcome)));

  const rows = await db.select({
    id: schema.webhookEvents.id,
    provider: schema.webhookEvents.provider,
    eventType: schema.webhookEvents.eventType,
    outcome: schema.webhookEvents.outcome,
    signatureOk: schema.webhookEvents.signatureOk,
    detail: schema.webhookEvents.detail,
    bodyExcerpt: schema.webhookEvents.bodyExcerpt,
    createdAt: schema.webhookEvents.createdAt,
    workspace: schema.tenants.name
  }).from(schema.webhookEvents)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.webhookEvents.tenantId))
    .where(filters.length ? and(...filters) : sql`true`)
    .orderBy(desc(schema.webhookEvents.createdAt))
    .limit(Number(q.limit) || 100);

  // A count by outcome, so a run of rejections is visible without reading rows.
  const summary = await db.select({
    outcome: schema.webhookEvents.outcome,
    n: sql<number>`count(*)`
  }).from(schema.webhookEvents).groupBy(schema.webhookEvents.outcome);

  return { events: rows, summary };
});
