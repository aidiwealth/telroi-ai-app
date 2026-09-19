// DELETE /api/admin/support/crm/contacts/:id/tags?tagId=...
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const { tenantId } = await ensureSupportWorkspace();
  const contactId = getRouterParam(event, 'id') || '';
  const tagId = String(getQuery(event).tagId || '');
  if (!contactId || !tagId) throw apiError('invalid', 'tagId is required');

  await useDb().delete(schema.crmContactTags).where(and(
    eq(schema.crmContactTags.contactId, contactId),
    eq(schema.crmContactTags.tagId, tagId),
    eq(schema.crmContactTags.tenantId, tenantId)
  ));
  return { ok: true };
});
