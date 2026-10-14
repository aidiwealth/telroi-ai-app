// GET /api/tenant/sub-accounts -> the workspace's sub-accounts with light usage.
import { and, eq, desc, sql } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.subAccounts)
    .where(eq(schema.subAccounts.parentTenantId, s.tenantId))
    .orderBy(desc(schema.subAccounts.createdAt));
  // key counts + otp counts per sub-account (cheap aggregates)
  const ids = rows.map((r) => r.id);
  const keyCounts: Record<string, number> = {};
  const otpCounts: Record<string, number> = {};
  if (ids.length) {
    const ks = await db.select({ sa: schema.apiKeys.subAccountId, c: sql<number>`count(*)` })
      .from(schema.apiKeys).where(and(eq(schema.apiKeys.tenantId, s.tenantId), sql`${schema.apiKeys.subAccountId} is not null`, sql`${schema.apiKeys.revokedAt} is null`))
      .groupBy(schema.apiKeys.subAccountId);
    for (const k of ks) if (k.sa) keyCounts[k.sa] = Number(k.c);
    const os = await db.select({ sa: schema.voiceOtps.subAccountId, c: sql<number>`count(*)` })
      .from(schema.voiceOtps).where(sql`${schema.voiceOtps.subAccountId} is not null`)
      .groupBy(schema.voiceOtps.subAccountId);
    for (const o of os) if (o.sa) otpCounts[o.sa] = Number(o.c);
  }
  return { subAccounts: rows.map((r) => ({
    id: r.id, name: r.name, reference: r.reference, status: r.status, createdAt: r.createdAt,
    keyCount: keyCounts[r.id] || 0, otpCount: otpCounts[r.id] || 0
  })) };
});
