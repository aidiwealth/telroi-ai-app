import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { createContact } from '~/server/utils/crm';
const Body = z.object({
  name: z.string().max(120).optional(), company: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal('')), phone: z.string().max(32).optional(),
  altPhone: z.string().max(32).optional(), country: z.string().optional(), region: z.string().optional(),
  city: z.string().optional(), status: z.enum(['lead','active','customer','churned']).optional(),
  tags: z.array(z.string()).optional(), source: z.string().optional()
});
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One. Upgrade to unlock.', 402);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid contact');
  const data: any = { source: 'manual', ...p.data }; if (data.email === '') delete data.email;
  const row = await createContact(s.tenantId, data);
  if (!row) throw apiError('duplicate', 'A contact with that phone number already exists.', 409);
  return { contact: row };
});
