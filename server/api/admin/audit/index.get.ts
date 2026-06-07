// GET /api/admin/audit -> searchable admin audit trail. Superadmin only.
// Query params: q (search actor/path/action/summary), actor (filter by email),
// limit, before (ISO cursor for pagination).
import { and, or, ilike, lt, desc } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const { q, actor, before, limit } = getQuery(event);
  const db = useDb();
  const conds: any[] = [];
  if (q && typeof q === 'string' && q.trim()) {
    const term = `%${q.trim()}%`;
    conds.push(or(
      ilike(schema.adminAuditLog.actorEmail, term),
      ilike(schema.adminAuditLog.path, term),
      ilike(schema.adminAuditLog.action, term),
      ilike(schema.adminAuditLog.summary, term)
    ));
  }
  if (actor && typeof actor === 'string' && actor.trim()) {
    conds.push(ilike(schema.adminAuditLog.actorEmail, `%${actor.trim()}%`));
  }
  if (before && typeof before === 'string') {
    const d = new Date(before);
    if (!isNaN(d.getTime())) conds.push(lt(schema.adminAuditLog.createdAt, d));
  }
  const n = Math.min(Math.max(parseInt(String(limit || '50'), 10) || 50, 1), 100);
  const rows = await db.select().from(schema.adminAuditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.adminAuditLog.createdAt))
    .limit(n);
  // distinct actors for the filter dropdown
  const actorsRows = await db.selectDistinct({ email: schema.adminAuditLog.actorEmail }).from(schema.adminAuditLog).limit(100);
  return { entries: rows, actors: actorsRows.map((a) => a.email).sort() };
});
