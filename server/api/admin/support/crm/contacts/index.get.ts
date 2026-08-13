import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { listContacts, syncCallsToContacts } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  // The support desk's own inbound calls should reach its CRM the same way a
  // client's do. The client endpoint has always done this; this one didn't, so
  // anyone who called support was never recorded as having done so.
  await syncCallsToContacts(ws.tenantId);

  const q = getQuery(event);
  const sources = typeof q.sources === 'string' && q.sources ? String(q.sources).split(',') : undefined;
  // listContacts returns { items, total } since paging was added — this endpoint
  // still passed the whole envelope through as "contacts", so the board received
  // an object where it expected an array: nothing rendered, and switching view
  // iterated over it and blanked the page. The client endpoint was updated at
  // the time; this one was missed.
  const { items, total } = await listContacts(ws.tenantId, {
    q: q.q ? String(q.q) : undefined,
    status: q.status ? String(q.status) : undefined,
    sources,
    limit: 200
  });
  return { contacts: items, total };
});
