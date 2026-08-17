import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { listContacts, syncCallsToContacts } from '~/server/utils/crm';
import { pageParams } from '~/server/utils/paginate';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'crm'))) throw apiError('feature_locked', 'CRM is part of Telroi One. Upgrade to unlock.', 402);
  // Pull recent inbound call numbers into the CRM first (idempotent; respects
  // the autoLinkCalls setting), so calls flow into contacts automatically.
  await syncCallsToContacts(s.tenantId);
  const q = getQuery(event);
  // 200, as before. This feeds a kanban board that sorts every contact into
  // status columns — paging it would show page two with columns missing their
  // cards, which is not a smaller view but a wrong one. Paging is supported for
  // anything that wants it; the board simply asks for the lot.
  const p = pageParams(event, 200);
  const { items, total } = await listContacts(s.tenantId, {
    q: q.q as string,
    status: q.status as string,
    sources: q.sources ? String(q.sources).split(',') : undefined,
    // Archived contacts only when asked for, so the board shows the people
    // somebody is actually working with.
    archived: q.archived === '1' || q.archived === 'true',
    limit: p.limit, offset: p.offset
  });
  // contacts kept as the key so nothing calling this has to change, with the
  // paging alongside.
  return { contacts: items, total, page: p.page, perPage: p.perPage, pages: Math.max(1, Math.ceil(total / p.perPage)) };
});
