import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { putObject, buildKey } from '~/server/utils/storage';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const form = await readMultipartFormData(event);
  const file = form?.find((f) => f.name === 'file');
  if (!file?.data) throw apiError('invalid', 'No file');
  const MAX = 10 * 1024 * 1024;
  if (file.data.length > MAX) throw apiError('invalid', 'File exceeds the 10MB limit');
  const type = file.type || 'text/csv';
  const okType = /csv|text\/plain|excel|spreadsheet|octet-stream/i.test(type) || /\.csv$/i.test(file.filename || '');
  if (!okType) throw apiError('invalid', 'Only CSV files are accepted');
  const key = buildKey('crm-imports', ws.tenantId, file.filename || 'import.csv');
  await putObject(key, file.data as Buffer, type);
  return { key };
});
