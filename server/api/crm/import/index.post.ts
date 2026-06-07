import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  source: z.enum(['manual', 'google', 'import', 'CRM', 'API', 'SIP']).default('manual'),
  fileName: z.string().optional(), fileKey: z.string().optional(),
  fileType: z.enum(['csv', 'xlsx']).optional(), driveUrl: z.string().url().optional()
}).refine((d) => d.fileKey || d.driveUrl, { message: 'fileKey or driveUrl required' });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One.', 402);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid import');
  const db = useDb();
  const [job] = await db.insert(schema.crmImportJobs).values({
    tenantId: s.tenantId, createdByUserId: s.userId, source: p.data.source,
    fileName: p.data.fileName || null, fileKey: p.data.fileKey || null,
    fileType: p.data.fileType || null, driveUrl: p.data.driveUrl || null, status: 'pending'
  }).returning();
  // Kick processing in the background (don't await) so the request returns fast.
  const { processImportJob } = await import('~/server/utils/crm-import');
  processImportJob(job.id).catch(() => { /* status reflects failure */ });
  return { job: { id: job.id, status: job.status } };
});
