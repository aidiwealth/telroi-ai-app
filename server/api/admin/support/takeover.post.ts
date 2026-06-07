// POST /api/admin/support/takeover { callid } -> admin takes over a support AI call.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { takeOverCall } from '~/server/utils/call-takeover';
const Body = z.object({ callid: z.string().min(1) });
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'callid required');
  const ws = await ensureSupportWorkspace();
  // Platform admins aren't rows in `users`, so don't pass an id for the FK —
  // attribute the takeover by label. (Passing the tenantId here was the cause of
  // the call_events foreign-key violation.)
  return await takeOverCall({ tenantId: ws.tenantId, callid: p.data.callid, userId: null, userLabel: (admin as any).name || (admin as any).email || 'Support agent' });
});
