// GET /api/admin/recordings?tenantId=&page= -> recordings across the platform.
//
// An operator handling a complaint needs the recording, and asking the client to
// send it is both slow and a poor answer when the complaint is about them.
import { eq, desc, sql, and, gt } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { pageParams, paged } from '~/server/utils/paginate';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const db = useDb();
  const p = pageParams(event, 25);

  const conds: any[] = [eq(schema.callRecordings.status, 'stored'), gt(schema.callRecordings.expiresAt, new Date())];
  if (q.tenantId) conds.push(eq(schema.callRecordings.tenantId, String(q.tenantId)));
  const where = and(...conds);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.callRecordings).where(where);

  const rows = await db.select({
    id: schema.callRecordings.id,
    callid: schema.callRecordings.callid,
    telnum: schema.callRecordings.telnum,
    direction: schema.callRecordings.direction,
    phone: schema.callRecordings.phone,
    durationSeconds: schema.callRecordings.durationSeconds,
    sizeBytes: schema.callRecordings.sizeBytes,
    carrier: schema.callRecordings.carrier,
    expiresAt: schema.callRecordings.expiresAt,
    createdAt: schema.callRecordings.createdAt,
    workspace: schema.tenants.name
  }).from(schema.callRecordings)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.callRecordings.tenantId))
    .where(where)
    .orderBy(desc(schema.callRecordings.createdAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows, Number(total), p);
});
