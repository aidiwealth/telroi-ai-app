// GET /api/compliance -> the tenant's compliance status + uploaded doc filenames.
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const [row] = await db.select().from(schema.compliance).where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);
  const policy = t?.policyAcceptedAt ? { acceptedAt: t.policyAcceptedAt, version: t.policyVersion } : null;
  if (!row) return { compliance: null, policy };
  return {
    compliance: {
      status: row.status, officialName: row.officialName,
      businessLicenseName: row.businessLicenseName, regulatoryLicenseName: row.regulatoryLicenseName,
      submittedAt: row.submittedAt, notes: row.notes
    },
    policy
  };
});
