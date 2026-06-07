// Resolve a tenant by its domain or synthetic slug.telroi.ai (admin use).
import { or, eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
export async function resolveTenantByDomain(domain: string) {
  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  return tenant || null;
}
