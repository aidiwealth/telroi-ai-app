// POST /api/admin/clients/:domain/blacklist { telnum, comment } -> operator blocks
// a number on the client's behalf. Writes the local (carrier-agnostic) entry and
// mirrors to the client's PBX. Superadmin or support role per platform policy.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
const Body = z.object({ telnum: z.string().min(3).max(32), comment: z.string().max(200).optional() });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A number is required');
  const db = useDb();
  const [existing] = await db.select().from(schema.blacklist)
    .where(and(eq(schema.blacklist.tenantId, t.id), eq(schema.blacklist.telnum, p.data.telnum))).limit(1);
  if (!existing) {
    await db.insert(schema.blacklist).values({ tenantId: t.id, telnum: p.data.telnum, comment: p.data.comment || 'Added by operator' });
  } else if (p.data.comment !== undefined) {
    await db.update(schema.blacklist).set({ comment: p.data.comment }).where(eq(schema.blacklist.id, existing.id));
  }
  // Mirror to PBX (best-effort).
  try {
    const { telroiFor } = await import('~/server/utils/tenant');
    const client = await telroiFor(t.id);
    await client.addBlacklist([{ telnum: p.data.telnum, comment: p.data.comment }]);
  } catch { /* */ }
  return { ok: true };
});
