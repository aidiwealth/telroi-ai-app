// server/utils/trial-ai.ts
// How much AI a workspace on trial has left before the wallet takes over.
//
// Free during the trial is a deliberate offer: it lets somebody hear the product
// working before they've paid anything, which is when they decide whether it's
// worth paying for. The allowance is what makes that offer affordable — a cap in
// money rather than calls, since a two-minute conversation and a twenty-minute one
// cost very different amounts.
import { and, eq, gte, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { trialActive } from '~/server/utils/entitlements';

export interface TrialAiStatus {
  onTrial: boolean;
  allowanceMinor: number;
  spentMinor: number;
  remainingMinor: number;
  exhausted: boolean;
  /** Ceiling on any one call while trialling. Zero means no limit. */
  callMaxSeconds: number;
}

export async function trialAiStatus(tenantId: string): Promise<TrialAiStatus> {
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId)).limit(1);

  const onTrial = tenant ? trialActive(tenant as any) : false;
  if (!onTrial) {
    return { onTrial: false, allowanceMinor: 0, spentMinor: 0, remainingMinor: 0, exhausted: false, callMaxSeconds: 0 };
  }

  const [platform] = await db.select({
    allowance: schema.platformSettings.trialAiAllowanceUsdMinor,
    callMax: schema.platformSettings.trialCallMaxSeconds
  }).from(schema.platformSettings).limit(1);
  const allowanceMinor = tenant?.trialAiAllowanceUsdMinor ?? platform?.allowance ?? 500;
  const callMaxSeconds = tenant?.trialCallMaxSeconds ?? platform?.callMax ?? 300;

  // Only usage since the trial began counts — a workspace that trialled, lapsed
  // and started again shouldn't inherit the first attempt's spending.
  const since = tenant?.trialStartedAt || tenant?.createdAt || new Date(0);
  const [used] = await db.select({ spent: sql<number>`coalesce(sum(cost_nano_usd), 0)::bigint` })
    .from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.tenantId, tenantId), gte(schema.aiUsage.createdAt, since)));

  // The allowance is set in cents, which is the unit an operator thinks in;
  // usage accrues in nano. Compared here rather than at either edge, so both
  // stay in the units that suit them.
  const spentMinor = Math.round(Number(used?.spent || 0) / 1e7);
  return {
    onTrial: true,
    allowanceMinor,
    spentMinor,
    remainingMinor: Math.max(0, allowanceMinor - spentMinor),
    exhausted: spentMinor >= allowanceMinor,
    callMaxSeconds
  };
}
