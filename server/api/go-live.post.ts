// POST /api/go-live { plan: 'startup'|'growth' }
// The client's own move from sandbox to live. Two gates, both deliberate:
// compliance must already be approved by an operator, and the client picks the
// plan they'll actually be billed on. Approval alone never starts billing —
// nobody should find themselves paying because an admin clicked approve.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { goLiveState, activateWorkspace } from '~/server/utils/go-live';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ plan: z.enum(['startup', 'growth']) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Choose a plan to go live');

  const state = await goLiveState(s.tenantId);
  if (state.live) return { ok: true, alreadyLive: true };

  if (!state.approved) {
    const msg = state.complianceStatus === 'pending'
      ? 'Your compliance submission is still under review.'
      : state.complianceStatus === 'rejected'
        ? 'Your compliance submission needs attention before you can go live.'
        : 'Submit your compliance details before going live.';
    throw apiError(state.blockedReason || 'not_approved', msg, 403);
  }

  const db = useDb();
  // Real plan, no trial — going live means the plan fee applies from here.
  await db.update(schema.tenants).set({
    plan: p.data.plan, trialPlan: null, trialEndsAt: null, planSelected: true
  }).where(eq(schema.tenants.id, s.tenantId));

  const res = await activateWorkspace(s.tenantId);
  if (!res.ok) throw apiError(res.reason || 'failed', 'Could not activate the workspace.', 400);

  await logEvent({
    tenantId: s.tenantId, kind: 'system', action: 'workspace.went_live',
    summary: `Went live on ${p.data.plan}`
  });

  return { ok: true, plan: p.data.plan, live: true };
});
