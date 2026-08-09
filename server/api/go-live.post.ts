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
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  // A running trial is kept. Someone three days into seven shouldn't lose four
  // by deciding early which plan they want — the plan takes effect when the trial
  // ends. Only a trial that's already expired is cleared.
  const { trialActive } = await import('~/server/utils/entitlements');
  const stillTrialing = tenant ? trialActive(tenant as any) : false;

  await db.update(schema.tenants).set({
    plan: p.data.plan,
    planSelected: true,
    ...(stillTrialing ? {} : { trialPlan: null, trialEndsAt: null })
  }).where(eq(schema.tenants.id, s.tenantId));

  const res = await activateWorkspace(s.tenantId);
  if (!res.ok) throw apiError(res.reason || 'failed', 'Could not activate the workspace.', 400);

  // Going live is what triggers the carrier setup a workspace needs to place
  // real calls. The sandbox toggle has always done this; going live through the
  // proper flow skipped it, so a client who chose a plan was live on paper with
  // nothing provisioned behind it. Best-effort: a hiccup here shouldn't undo the
  // activation they've just paid to start.
  let provisioning: any = null;
  try {
    const { provisionOnGoLive } = await import('~/server/utils/provision-lifecycle');
    provisioning = await provisionOnGoLive(s.tenantId);
  } catch (e: any) {
    provisioning = { ok: false, reason: e?.message };
  }

  await logEvent({
    tenantId: s.tenantId, kind: 'system', action: 'workspace.went_live',
    summary: `Went live on ${p.data.plan}`
  });

  // The moment that actually earns something, as distinct from a signup. Sent
  // after activation rather than before, so the channel never announces a
  // go-live that then failed.
  import('~/server/utils/slack').then(({ slackWentLive }) =>
    slackWentLive({
      name: tenant?.name || s.tenantId,
      slug: (tenant as any)?.slug || '',
      plan: p.data.plan,
      email: s.email
    })
  ).catch((e) => console.error('slack go-live notice failed', e));

  return {
    ok: true, plan: p.data.plan, live: true, provisioning,
    // So the client can be told when their plan actually starts charging.
    trialEndsAt: stillTrialing ? tenant?.trialEndsAt ?? null : null
  };
});
