// POST /api/admin/support/crm/contacts/:id/notes -> add a note to a support CRM
// contact.
//
// The body went in unvalidated and unfiltered, so an empty note was storable —
// and kind and callUid were dropped, meaning a support note could never be a call
// report or be tied to the call it was about.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { addNote } from '~/server/utils/crm';

const Body = z.object({
  body: z.string().min(1).max(4000),
  kind: z.enum(['note', 'call_report']).optional(),
  callUid: z.string().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A note body is required');
  const author = (admin as any).id || ws.tenantId;
  return { note: await addNote(ws.tenantId, getRouterParam(event, 'id')!, author, p.data.body, p.data.kind || 'note', p.data.callUid) };
});
