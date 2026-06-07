// GET /api/admin/calls?client=&kind=&cursor=&limit= -> system-wide call log
// across all tenants, keyset-paginated (scales to large volumes). Returns a
// nextCursor when more rows exist. Any platform admin.
import { and, eq, desc, lt, or, inArray, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { encodeCursor, decodeCursor, clampLimit } from '~/server/utils/cursor';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const db = useDb();
  const limit = clampLimit(q.limit);
  const cur = decodeCursor(q.cursor as string);

  let tenantFilter: string | null = null;
  if (q.client) {
    const slug = String(q.client).replace(/\.telroi\.ai$/, '').split('.')[0];
    const [t] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
    tenantFilter = t?.id || '__none__';
  }

  const conds: any[] = [];
  if (tenantFilter) conds.push(eq(schema.callEvents.tenantId, tenantFilter));
  if (q.kind === 'failed') conds.push(eq(schema.callEvents.status, 'failed'));
  // Keyset seek: rows strictly "older" than the cursor tuple (startedAt, id).
  if (cur) {
    conds.push(or(
      lt(schema.callEvents.startedAt, new Date(cur.t)),
      and(eq(schema.callEvents.startedAt, new Date(cur.t)), lt(schema.callEvents.id, cur.id))
    ));
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db.select().from(schema.callEvents)
    .where(where as any)
    .orderBy(desc(schema.callEvents.startedAt), desc(schema.callEvents.id))
    .limit(limit + 1); // fetch one extra to know if there's a next page

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const tenantIds = [...new Set(page.map((r) => r.tenantId))];
  const names = tenantIds.length
    ? await db.select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug })
        .from(schema.tenants).where(inArray(schema.tenants.id, tenantIds))
    : [];
  const nameById = new Map(names.map((t) => [t.id, t]));

  const calls = page.map((r) => ({
    id: r.id,
    workspace: nameById.get(r.tenantId)?.name || '—',
    slug: nameById.get(r.tenantId)?.slug || null,
    direction: r.direction || r.type || 'out',
    carrier: r.carrier || null,
    phone: r.phone || '—',
    user: r.user || null,
    status: r.status === 'failed' ? 'Failed' : (r.status || 'placed'),
    failed: r.status === 'failed',
    reason: (r.raw as any)?.reason || null,
    startedAt: r.startedAt || r.createdAt,
    duration: r.duration || 0
  }));

  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ t: (last.startedAt || last.createdAt as any).toISOString?.() || String(last.startedAt), id: last.id })
    : null;

  return { calls, nextCursor };
});
