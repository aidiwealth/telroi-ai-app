// GET /api/admin/compliance/:tenantId/document?doc=business|regulatory
// Streams a KYC document through our server to an authenticated operator.
// The R2 bucket stays private; nothing is ever served via a public URL.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const doc = (getQuery(event).doc as string) || 'business';

  const db = useDb();
  const [row] = await db.select().from(schema.compliance).where(eq(schema.compliance.tenantId, tenantId)).limit(1);
  if (!row) throw apiError('not_found', 'No compliance record', 404);

  const key = doc === 'regulatory' ? row.regulatoryLicenseKey : row.businessLicenseKey;
  const name = doc === 'regulatory' ? row.regulatoryLicenseName : row.businessLicenseName;
  if (!key) throw apiError('not_found', 'Document not uploaded', 404);

  try {
    const { body, contentType } = await getObject(key);
    setHeader(event, 'Content-Type', contentType);
    // inline so PDFs/images open in a new tab; filename preserved for downloads
    setHeader(event, 'Content-Disposition', `inline; filename="${(name || 'document').replace(/"/g, '')}"`);
    setHeader(event, 'Cache-Control', 'private, no-store');
    return body;
  } catch (e: any) {
    throw apiError('storage_error', 'Could not retrieve the document', 502);
  }
});
