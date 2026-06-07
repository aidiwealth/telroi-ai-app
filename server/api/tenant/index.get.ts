// GET /api/tenant -> current tenant
import { requireTenant } from '~/server/utils/api';
import { loadTenant } from '~/server/utils/tenant';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const t = await loadTenant(s.tenantId);
  return { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, onboardingStep: t.onboardingStep, provisioned: !!t.telroiApiKeyEnc };
});
