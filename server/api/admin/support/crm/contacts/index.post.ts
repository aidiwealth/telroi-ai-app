// POST /api/admin/support/crm/contacts -> add a contact to the support desk's CRM.
//
// Passed the raw request body straight through, so any field the form sent
// reached the insert — including ones that aren't columns — and a duplicate
// phone number came back as an empty success rather than saying so.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { createContact } from '~/server/utils/crm';

const Body = z.object({
  name: z.string().max(120).optional(), company: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal('')), phone: z.string().max(32).optional(),
  altPhone: z.string().max(32).optional(), country: z.string().optional(), region: z.string().optional(),
  city: z.string().optional(), status: z.enum(['lead', 'active', 'customer', 'churned']).optional(),
  tags: z.array(z.string()).optional(), source: z.string().optional()
});

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid contact');
  const data: any = { source: 'manual', ...p.data };
  if (data.email === '') delete data.email;
  const row = await createContact(ws.tenantId, data);
  if (!row) throw apiError('duplicate', 'A contact with that phone number already exists.', 409);
  return { contact: row };
});
