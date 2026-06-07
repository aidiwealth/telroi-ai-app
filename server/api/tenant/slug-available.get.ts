// GET /api/tenant/slug-available?slug=acme
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

const RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'one', 'dashboard', 'telroi'];

export default defineEventHandler(async (event) => {
  // Per-IP cap: unauthenticated DB lookup, also limits slug enumeration.
  const { rateLimit, clientIp } = await import('~/server/utils/api');
  rateLimit('slug_check_ip', clientIp(event), 60, 60 * 1000);
  const slug = String(getQuery(event).slug || '').toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return { available: false, reason: 'invalid' };
  if (RESERVED.includes(slug)) return { available: false, reason: 'reserved' };
  const db = useDb();
  const rows = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
  return { available: rows.length === 0 };
});
