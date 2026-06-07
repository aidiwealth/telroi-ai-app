// GET /api/admin/email-templates/:key/preview -> rendered HTML + subject for the
// template (with any saved overrides applied), using sample data.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { renderEmailPreview } from '~/server/utils/email';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const key = getRouterParam(event, 'key')!;
  const { subject, html } = await renderEmailPreview(key);
  return { key, subject, html };
});
