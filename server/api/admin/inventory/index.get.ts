// GET /api/admin/inventory?status=&provider=&region=&page=
//
// Who holds each number, not just which are free. An operator looking at a
// number somebody has rung wants to know whose it is, and that answer was a
// database query away rather than on the page.
import { desc, eq, and, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { pageParams, paged } from '~/server/utils/paginate';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const db = useDb();
  const p = pageParams(event, 50);

  const conds: any[] = [];
  if (q.status) conds.push(eq(schema.numberInventory.status, String(q.status)));
  if (q.provider) conds.push(eq(schema.numberInventory.provider, String(q.provider)));
  if (q.region) conds.push(eq(schema.numberInventory.region, String(q.region)));
  const where = conds.length ? and(...conds) : undefined;

  // The count carries the same filters, or "12 of 300" while looking at one
  // carrier would read as the filter not having applied.
  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.numberInventory).where(where as any);

  const rows = await db.select({
    id: schema.numberInventory.id,
    telnum: schema.numberInventory.telnum,
    region: schema.numberInventory.region,
    provider: schema.numberInventory.provider,
    status: schema.numberInventory.status,
    provisionStatus: schema.numberInventory.provisionStatus,
    provisionRef: schema.numberInventory.provisionRef,
    createdAt: schema.numberInventory.createdAt,
    soldToTenantId: schema.numberInventory.soldToTenantId,
    holder: schema.tenants.name,
    holderSlug: schema.tenants.slug
  }).from(schema.numberInventory)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.numberInventory.soldToTenantId))
    .where(where as any)
    .orderBy(desc(schema.numberInventory.createdAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows, Number(total), p);
});
