import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { addNote } from '~/server/utils/crm';
const Body = z.object({ body: z.string().min(1).max(4000), kind: z.enum(['note','call_report']).optional(), callUid: z.string().optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One. Upgrade to unlock.', 402);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A note body is required');
  return { note: await addNote(s.tenantId, getRouterParam(event, 'id')!, s.userId, p.data.body, p.data.kind || 'note', p.data.callUid) };
});
