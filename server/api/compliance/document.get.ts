// GET /api/compliance/document?doc=business|regulatory
// Streams the CLIENT's own uploaded KYC document back to them (private; the
// tenant can only ever fetch their own files).
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const doc = (getQuery(event).doc as string) || 'business';
  const db = useDb();
  const [row] = await db.select().from(schema.compliance).where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);
  if (!row) throw apiError('not_found', 'No compliance record', 404);

  const key = doc === 'regulatory' ? row.regulatoryLicenseKey : row.businessLicenseKey;
  const name = doc === 'regulatory' ? row.regulatoryLicenseName : row.businessLicenseName;
  if (!key) throw apiError('not_found', 'Document not uploaded', 404);

  try {
    const { body, contentType } = await getObject(key);
    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Content-Disposition', `inline; filename="${(name || 'document').replace(/"/g, '')}"`);
    setHeader(event, 'Cache-Control', 'private, no-store');
    return body;
  } catch {
    throw apiError('storage_error', 'Could not retrieve the document', 502);
  }
});
