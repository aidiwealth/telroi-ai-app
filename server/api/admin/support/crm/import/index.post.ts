import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  source: z.enum(['manual', 'google', 'import', 'CRM', 'API', 'SIP']).default('manual'),
  fileName: z.string().optional(), fileKey: z.string().optional(),
  fileType: z.enum(['csv', 'xlsx']).optional(), driveUrl: z.string().url().optional()
}).refine((d) => d.fileKey || d.driveUrl, { message: 'fileKey or driveUrl required' });
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid import');
  const db = useDb();
  const [job] = await db.insert(schema.crmImportJobs).values({
    tenantId: ws.tenantId, createdByUserId: (admin as any).id || ws.tenantId, source: p.data.source,
    fileName: p.data.fileName || null, fileKey: p.data.fileKey || null,
    fileType: p.data.fileType || null, driveUrl: p.data.driveUrl || null, status: 'pending'
  }).returning();
  const { processImportJob } = await import('~/server/utils/crm-import');
  processImportJob(job.id).catch(() => { /* */ });
  return { job: { id: job.id, status: job.status } };
});
