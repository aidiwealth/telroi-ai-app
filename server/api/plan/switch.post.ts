// POST /api/plan/switch { plan: 'startup'|'growth' }
// Upgrade/downgrade from settings. Upgrading to growth sets the base plan to
// growth (a real, billable upgrade — distinct from the signup trial).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ plan: z.enum(['startup', 'growth']) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Choose a plan');
  const db = useDb();
  // Switching to a real plan clears any trial (the base plan now governs).
  await db.update(schema.tenants).set({
    plan: p.data.plan, trialPlan: null, trialEndsAt: null, planSelected: true
  }).where(eq(schema.tenants.id, s.tenantId));
  return { ok: true, plan: p.data.plan };
});
