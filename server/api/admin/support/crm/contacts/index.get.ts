import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { listContacts } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const q = getQuery(event);
  const sources = typeof q.sources === 'string' && q.sources ? String(q.sources).split(',') : undefined;
  const contacts = await listContacts(ws.tenantId, { q: q.q ? String(q.q) : undefined, status: q.status ? String(q.status) : undefined, sources });
  return { contacts };
});
