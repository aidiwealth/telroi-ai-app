import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { presignPut, buildKey, storageBackend } from '~/server/utils/storage';
const Body = z.object({ fileName: z.string().min(1), contentType: z.string().default('text/csv') });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'fileName required');
  const key = buildKey('crm-imports', ws.tenantId, p.data.fileName);
  const url = await presignPut(key, p.data.contentType);
  return { key, url, backend: storageBackend() };
});
