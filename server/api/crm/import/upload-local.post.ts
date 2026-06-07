import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { putObject, buildKey } from '~/server/utils/storage';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One.', 402);
  const form = await readMultipartFormData(event);
  const file = form?.find((f) => f.name === 'file');
  if (!file?.data) throw apiError('invalid', 'No file');
  // Bound the upload: CSV imports only, max 10MB, to prevent storage abuse / DoS.
  const MAX = 10 * 1024 * 1024;
  if (file.data.length > MAX) throw apiError('invalid', 'File exceeds the 10MB limit');
  const type = file.type || 'text/csv';
  const okType = /csv|text\/plain|excel|spreadsheet|octet-stream/i.test(type) || /\.csv$/i.test(file.filename || '');
  if (!okType) throw apiError('invalid', 'Only CSV files are accepted');
  const key = buildKey('crm-imports', s.tenantId, file.filename || 'import.csv');
  await putObject(key, file.data as Buffer, type);
  return { key };
});
