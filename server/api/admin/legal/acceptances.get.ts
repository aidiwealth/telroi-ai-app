// GET /api/admin/legal/acceptances -> the register.
//
// Every acceptance, with who gave it and on what authority. An operator asked by
// a carrier "who agreed to this, and to what wording" needs one place that
// answers both, so the document version comes back with the row and the text
// itself is one click further.
import { and, eq, desc, ilike, or, sql, inArray } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { pageParams, paged } from '~/server/utils/paginate';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const q = getQuery(event);
  const db = useDb();
  const p = pageParams(event);

  const conds: any[] = [];
  if (q.q) {
    const like = `%${String(q.q)}%`;
    conds.push(or(
      ilike(schema.legalAcceptances.telnum, like),
      ilike(schema.legalAcceptances.userEmail, like),
      ilike(schema.tenants.name, like)
    ));
  }
  // Postgres array containment, so filtering by a category finds an acceptance
  // that named it among several.
  if (q.category) {
    conds.push(sql`${schema.legalAcceptances.declaredCategories} @> ARRAY[${String(q.category)}]::text[]`);
  }
  if (q.tenantId) conds.push(eq(schema.legalAcceptances.tenantId, String(q.tenantId)));

  // Counted with the same conditions, so "12 of 340" is 12 of the filtered set
  // rather than of everything. A register that silently stopped at 500 would
  // have an operator conclude an acceptance was never recorded — which for this
  // list is exactly the wrong failure.
  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.legalAcceptances)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.legalAcceptances.tenantId))
    .innerJoin(schema.legalDocuments, eq(schema.legalDocuments.id, schema.legalAcceptances.documentId))
    .where(conds.length ? and(...conds) : undefined);

  const rows = await db.select({
    id: schema.legalAcceptances.id,
    telnum: schema.legalAcceptances.telnum,
    categories: schema.legalAcceptances.declaredCategories,
    userEmail: schema.legalAcceptances.userEmail,
    userRole: schema.legalAcceptances.userRole,
    ip: schema.legalAcceptances.ip,
    acceptedAt: schema.legalAcceptances.acceptedAt,
    tenantId: schema.tenants.id,
    tenantName: schema.tenants.name,
    docTitle: schema.legalDocuments.title,
    docVersion: schema.legalDocuments.version,
    documentId: schema.legalDocuments.id
  })
    .from(schema.legalAcceptances)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.legalAcceptances.tenantId))
    .innerJoin(schema.legalDocuments, eq(schema.legalDocuments.id, schema.legalAcceptances.documentId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.legalAcceptances.acceptedAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows, Number(total), p);
});
