import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { presignPut, buildKey, storageBackend } from '~/server/utils/storage';
const Body = z.object({ fileName: z.string().min(1), contentType: z.string().default('text/csv') });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One.', 402);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'fileName required');
  const key = buildKey('crm-imports', s.tenantId, p.data.fileName);
  const url = await presignPut(key, p.data.contentType);
  // url is null in local-dev (no R2) — caller then posts the file to /upload-local.
  return { key, url, backend: storageBackend() };
});
