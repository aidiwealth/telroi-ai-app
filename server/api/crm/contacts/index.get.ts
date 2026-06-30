import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { listContacts, syncCallsToContacts } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One. Upgrade to unlock.', 402);
  // Pull recent inbound call numbers into the CRM first (idempotent; respects
  // the autoLinkCalls setting), so calls flow into contacts automatically.
  await syncCallsToContacts(s.tenantId);
  const q = getQuery(event);
  return { contacts: await listContacts(s.tenantId, { q: q.q as string, status: q.status as string, sources: q.sources ? String(q.sources).split(',') : undefined }) };
});
