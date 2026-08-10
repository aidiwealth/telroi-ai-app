// GET /api/admin/audit -> searchable admin audit trail. Superadmin only.
// Query params: q (search actor/path/action/summary), actor (filter by email),
// limit, before (ISO cursor for pagination).
import { and, or, ilike, lt, desc, sql } from 'drizzle-orm';
import { pageParams } from '~/server/utils/paginate';
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
  const p = pageParams(event, 50);
  const where = conds.length ? and(...conds) : undefined;

  // The same conditions count as list. Filtering to one operator and being told
  // "of 4,000" would read as the filter not having applied.
  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.adminAuditLog).where(where as any);

  const rows = await db.select().from(schema.adminAuditLog)
    .where(where as any)
    .orderBy(desc(schema.adminAuditLog.createdAt))
    .limit(p.limit).offset(p.offset);
  // distinct actors for the filter dropdown
  const actorsRows = await db.selectDistinct({ email: schema.adminAuditLog.actorEmail }).from(schema.adminAuditLog).limit(100);
  return {
    entries: rows, actors: actorsRows.map((a) => a.email).sort(),
    total: Number(total), page: p.page, perPage: p.perPage,
    pages: Math.max(1, Math.ceil(Number(total) / p.perPage))
  };
});
