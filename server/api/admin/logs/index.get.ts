// GET /api/admin/logs?kind=call|system&limit= -> recent activity logs.
// Lightweight, newest-first, capped. Used by the operator Logs screens.
import { desc, eq, and, lte } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const kind = q.kind === 'call' ? 'call' : 'system';
  const limit = Math.min(Number(q.limit) || 100, 300);
  const db = useDb();

  const rows = await db.select({
    id: schema.logs.id, kind: schema.logs.kind, action: schema.logs.action,
    summary: schema.logs.summary, level: schema.logs.level, ref: schema.logs.ref,
    createdAt: schema.logs.createdAt, tenantId: schema.logs.tenantId,
    workspace: schema.tenants.name
  }).from(schema.logs)
    .leftJoin(schema.tenants, eq(schema.logs.tenantId, schema.tenants.id))
    .where(eq(schema.logs.kind, kind))
    .orderBy(desc(schema.logs.createdAt))
    .limit(limit);

  return { logs: rows, kind };
});
