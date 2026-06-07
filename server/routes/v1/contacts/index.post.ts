// POST /v1/contacts -> ingest contact(s) into the CRM via API (source = 'API').
// Accepts a single contact or an array (bulk up to 1000 per request; use the
// dashboard import for larger files). Requires an API key with contacts:write.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { upsertContactByPhone } from '~/server/utils/crm';
import { logEvent } from '~/server/utils/logs';

const One = z.object({
  phone: z.string().min(4), name: z.string().optional(), company: z.string().optional(),
  email: z.string().email().optional(), city: z.string().optional(), region: z.string().optional(), country: z.string().optional()
});
const Body = z.union([One, z.array(One).max(1000)]);

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'contacts:write')) throw apiError('forbidden', 'Key lacks contacts:write', 403);
  if (!(await hasFeature(ctx.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM (Telroi One) is not enabled for this workspace.', 402);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Provide a contact or an array of contacts (max 1000)');
  const list = Array.isArray(p.data) ? p.data : [p.data];
  let created = 0;
  for (const c of list) {
    const { phone, ...rest } = c;
    await upsertContactByPhone(ctx.tenantId, phone, { ...rest, source: 'API' });
    created++;
  }
  await logEvent({ tenantId: ctx.tenantId, kind: 'system', action: 'crm.api_ingest', summary: `API ingested ${created} contact(s)` });
  return { object: 'list', ingested: created };
});
