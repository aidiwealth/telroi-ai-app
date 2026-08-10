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
      submittedAt: row.submittedAt, notes: row.notes,
      // Whether the director has been verified, and who. Not the NIN itself:
      // the form only needs to know it is done, and sending an identity number
      // back to a browser that has no use for it is a habit worth not having.
      ninVerifiedAt: row.ninVerifiedAt, ninName: row.ninName, directorName: row.directorName
    },
    policy
  };
});
