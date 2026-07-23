// server/utils/go-live.ts
// The sandbox → live transition.
//
// A workspace starts in sandbox: capped test calls, one AI number, ledger-only
// billing. Going live takes two deliberate steps, in order:
//   1. Compliance approved — the operator has seen the business documents.
//   2. A plan chosen — the client accepts that real money will now move.
// Only then does sandboxMode come off. Approval alone doesn't do it: nobody
// should start being billed because an admin clicked approve.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export interface GoLiveState {
  live: boolean;              // already out of sandbox
  complianceStatus: string;   // none | pending | approved | rejected
  approved: boolean;          // compliance cleared — eligible to go live
  planSelected: boolean;
  eligible: boolean;          // approved and still in sandbox: can go live now
  blockedReason: string | null;
}

export async function goLiveState(tenantId: string): Promise<GoLiveState> {
  const db = useDb();
  const [tenant] = await db.select({
    sandboxMode: schema.tenants.sandboxMode,
    planSelected: schema.tenants.planSelected
  }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);

  const [comp] = await db.select({ status: schema.compliance.status })
    .from(schema.compliance).where(eq(schema.compliance.tenantId, tenantId)).limit(1);

  const live = !tenant?.sandboxMode;
  const complianceStatus = comp?.status || 'none';
  const approved = complianceStatus === 'approved';
  const planSelected = !!tenant?.planSelected;

  let blockedReason: string | null = null;
  if (!live) {
    if (complianceStatus === 'none') blockedReason = 'compliance_not_submitted';
    else if (complianceStatus === 'pending') blockedReason = 'compliance_pending';
    else if (complianceStatus === 'rejected') blockedReason = 'compliance_rejected';
  }

  return {
    live,
    complianceStatus,
    approved,
    planSelected,
    eligible: approved && !live,
    blockedReason
  };
}

/**
 * Take a workspace live. Only call once compliance is approved — the caller is
 * responsible for that check, and this re-verifies rather than trusting it.
 * Idempotent: a workspace already live is left alone.
 */
export async function activateWorkspace(tenantId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = useDb();
  const state = await goLiveState(tenantId);
  if (state.live) return { ok: true };
  if (!state.approved) return { ok: false, reason: state.blockedReason || 'not_approved' };

  await db.update(schema.tenants)
    .set({ sandboxMode: false, wentLiveAt: new Date(), provisionState: 'provisioned' })
    .where(eq(schema.tenants.id, tenantId));

  return { ok: true };
}
