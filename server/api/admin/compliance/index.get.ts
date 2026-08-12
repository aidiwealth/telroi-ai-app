// GET /api/admin/compliance -> all compliance submissions with workspace names.
import { desc, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const rows = await db.select({
    id: schema.compliance.id, tenantId: schema.compliance.tenantId,
    officialName: schema.compliance.officialName,
    businessLicenseName: schema.compliance.businessLicenseName,
    businessLicenseKey: schema.compliance.businessLicenseKey,
    regulatoryLicenseName: schema.compliance.regulatoryLicenseName,
    regulatoryLicenseKey: schema.compliance.regulatoryLicenseKey,
    status: schema.compliance.status, submittedAt: schema.compliance.submittedAt,
    reviewedAt: schema.compliance.reviewedAt, notes: schema.compliance.notes,
    // Identity verification, for the NIN view. The attempt count matters as much
    // as the result: five failures is somebody struggling, and worth a call
    // before they give up on going live.
    directorName: schema.compliance.directorName,
    useCase: schema.compliance.useCase,
    callAudience: schema.compliance.callAudience,
    ninVerifiedAt: schema.compliance.ninVerifiedAt,
    ninName: schema.compliance.ninName,
    ninReference: schema.compliance.ninReference,
    ninAttempts: schema.compliance.ninAttempts,
    ninLastAttemptAt: schema.compliance.ninLastAttemptAt,
    workspace: schema.tenants.name,
    country: schema.tenants.country
  }).from(schema.compliance)
    .leftJoin(schema.tenants, eq(schema.compliance.tenantId, schema.tenants.id))
    .orderBy(desc(schema.compliance.submittedAt));
  // Expose whether each doc exists (boolean) rather than the raw key.
  return { submissions: rows.map((r) => ({
    ...r,
    hasBusinessDoc: !!r.businessLicenseKey,
    hasRegulatoryDoc: !!r.regulatoryLicenseKey,
    businessLicenseKey: undefined, regulatoryLicenseKey: undefined
  })) };
});
