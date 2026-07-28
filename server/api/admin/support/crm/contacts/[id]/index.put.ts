// PUT /api/admin/support/crm/contacts/:id -> edit a support CRM contact.
// Validated rather than passing the request body straight to the update, which
// let any field the form sent reach the table.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { updateContact } from '~/server/utils/crm';

const Body = z.object({
  name: z.string().max(120).optional(), company: z.string().max(120).optional(),
  email: z.string().optional(), phone: z.string().max(32).optional(), altPhone: z.string().max(32).optional(),
  country: z.string().optional(), region: z.string().optional(), city: z.string().optional(),
  status: z.enum(['lead', 'active', 'customer', 'churned']).optional(), tags: z.array(z.string()).optional()
}).passthrough();

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid update');
  return { contact: await updateContact(ws.tenantId, getRouterParam(event, 'id')!, p.data as any) };
});
