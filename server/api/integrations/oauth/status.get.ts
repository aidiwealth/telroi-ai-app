// GET /api/integrations/oauth/status -> which providers have OAuth configured,
// so the UI can show "Connect with X" vs the manual token form.
import { requireTenant } from '~/server/utils/api';
import { oauthConfigured } from '~/server/utils/integrations/oauth';
export default defineEventHandler(async (event) => {
  await requireTenant(event);
  return { oauth: { hubspot: oauthConfigured('hubspot'), zoho: oauthConfigured('zoho'), pipedrive: oauthConfigured('pipedrive') } };
});
