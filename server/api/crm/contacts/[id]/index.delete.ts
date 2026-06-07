import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { deleteContact } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One. Upgrade to unlock.', 402);
  return await deleteContact(s.tenantId, getRouterParam(event, 'id')!);
});
