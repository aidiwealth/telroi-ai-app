// PATCH /api/tenant -> update name/slug/timezone/onboardingStep
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  timezone: z.string().optional(),
  onboardingStep: z.number().int().min(0).max(5).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Invalid tenant fields');
  const db = useDb();
  const [updated] = await db.update(schema.tenants).set(parsed.data).where(eq(schema.tenants.id, s.tenantId)).returning();

  // Local-first: completing onboarding NO LONGER provisions any vendor. The
  // workspace stays fully local (zero Digidite/carrier cost) and is usable in
  // sandbox. Vendor provisioning happens only at go-live, routed by country.
  return { id: updated.id, name: updated.name, slug: updated.slug, timezone: updated.timezone, onboardingStep: updated.onboardingStep, provisioned: updated.provisionState === 'provisioned' };
});
