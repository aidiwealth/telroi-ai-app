// POST /api/compliance (multipart) -> upload KYC documents to request live access.
// Accepts officialName + file uploads: businessLicense (always required) and
// regulatoryLicense (required for Nigerian accounts, optional elsewhere).
// Files are stored in R2 (or local fallback). Required before sandbox -> live.
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { buildKey, putObject } from '~/server/utils/storage';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB per file
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  // Parse the multipart body up front; report parse failures clearly.
  let parts;
  try {
    parts = await readMultipartFormData(event);
  } catch (e: any) {
    throw apiError('upload_failed', `Could not read the upload: ${e?.message || 'malformed form data'}`, 400);
  }
  if (!parts || !parts.length) throw apiError('invalid', 'No files were received. Please choose a document and try again.');

  let officialName = '';
  const files: Record<string, { data: Buffer; filename: string; type: string }> = {};
  for (const part of parts) {
    if (part.name === 'officialName') { officialName = (part.data?.toString('utf8') || '').trim(); continue; }
    if ((part.name === 'businessLicense' || part.name === 'regulatoryLicense') && part.filename) {
      const type = part.type || 'application/octet-stream';
      if (!ALLOWED.includes(type)) throw apiError('invalid', `${part.filename}: only PDF, PNG, JPG or WebP files are accepted`);
      if (part.data.length > MAX_BYTES) throw apiError('invalid', `${part.filename} exceeds the 5MB limit`);
      files[part.name] = { data: part.data, filename: part.filename, type };
    }
  }

  if (officialName.length < 2) throw apiError('invalid', 'Official business name is required');

  // Determine whether this is a Nigerian account (drives regulatory requirement).
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const isNigeria = (tenant?.country || '').toLowerCase() === 'nigeria';

  const [existing] = await db.select().from(schema.compliance).where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);

  // Business license always required (unless already on file from a prior submission).
  if (!files.businessLicense && !existing?.businessLicenseKey) {
    throw apiError('invalid', 'A business license document is required');
  }
  // Regulatory license required for Nigerian accounts.
  if (isNigeria && !files.regulatoryLicense && !existing?.regulatoryLicenseKey) {
    throw apiError('invalid', 'A regulatory license is required for Nigerian businesses');
  }

  // Upload provided files to storage; report storage failures clearly.
  const patch: Record<string, any> = { officialName, status: 'pending', submittedAt: new Date(), reviewedAt: null };
  try {
    if (files.businessLicense) {
      const key = buildKey('kyc', s.tenantId, files.businessLicense.filename);
      await putObject(key, files.businessLicense.data, files.businessLicense.type);
      patch.businessLicenseKey = key;
      patch.businessLicenseName = files.businessLicense.filename;
      patch.businessLicenseType = files.businessLicense.type;
    }
    if (files.regulatoryLicense) {
      const key = buildKey('kyc', s.tenantId, files.regulatoryLicense.filename);
      await putObject(key, files.regulatoryLicense.data, files.regulatoryLicense.type);
      patch.regulatoryLicenseKey = key;
      patch.regulatoryLicenseName = files.regulatoryLicense.filename;
      patch.regulatoryLicenseType = files.regulatoryLicense.type;
    }
  } catch (e: any) {
    console.error('[compliance] storage upload failed:', e);
    throw apiError('storage_error', `Could not store the document: ${e?.message || 'storage error'}`, 502);
  }

  if (existing) {
    const [row] = await db.update(schema.compliance).set(patch).where(eq(schema.compliance.tenantId, s.tenantId)).returning();
    return { compliance: sanitize(row) };
  }
  const [row] = await db.insert(schema.compliance).values({ tenantId: s.tenantId, ...patch }).returning();
  return { compliance: sanitize(row) };
});

function sanitize(row: any) {
  return {
    status: row.status, officialName: row.officialName,
    businessLicenseName: row.businessLicenseName, regulatoryLicenseName: row.regulatoryLicenseName,
    submittedAt: row.submittedAt
  };
}
