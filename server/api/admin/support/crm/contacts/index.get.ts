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
  const contacts = await listContacts(ws.tenantId, { q: q.q ? String(q.q) : undefined, status: q.status ? String(q.status) : undefined, sources });
  return { contacts };
});
