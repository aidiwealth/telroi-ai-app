// GET /api/admin/logs?kind=call|system&limit= -> recent activity logs.
// Lightweight, newest-first, capped. Used by the operator Logs screens.
import { desc, eq, and, lte, sql } from 'drizzle-orm';
import { pageParams } from '~/server/utils/paginate';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const kind = q.kind === 'call' ? 'call' : 'system';
  const db = useDb();
  const p = pageParams(event, 100);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.logs).where(eq(schema.logs.kind, kind));

  const rows = await db.select({
    id: schema.logs.id, kind: schema.logs.kind, action: schema.logs.action,
    summary: schema.logs.summary, level: schema.logs.level, ref: schema.logs.ref,
    createdAt: schema.logs.createdAt, tenantId: schema.logs.tenantId,
    workspace: schema.tenants.name
  }).from(schema.logs)
    .leftJoin(schema.tenants, eq(schema.logs.tenantId, schema.tenants.id))
    .where(eq(schema.logs.kind, kind))
    .orderBy(desc(schema.logs.createdAt))
    .limit(p.limit).offset(p.offset);

  // logs kept as the key so the page needs no change to keep working; the
  // paging fields ride alongside for the control.
  return {
    logs: rows, kind,
    total: Number(total), page: p.page, perPage: p.perPage,
    pages: Math.max(1, Math.ceil(Number(total) / p.perPage))
  };
});
