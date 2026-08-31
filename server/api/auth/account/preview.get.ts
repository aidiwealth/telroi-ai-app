// GET /api/auth/account/preview
//
// What deleting this account would actually do, so the app can say it before
// asking rather than after. A sole owner is closing a workspace that may hold
// numbers and money, and losing a balance to a tap is the one irreversible
// thing worth slowing somebody down for.
import { requireTenant } from '~/server/utils/api';
import { workspaceStanding } from '~/server/utils/account-deletion';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { and, eq, isNull } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const standing = await workspaceStanding(s.tenantId, s.userId);
  const db = useDb();

  const [tenant] = await db.select({ name: schema.tenants.name })
    .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  // Only worth counting when the workspace would close with them.
  const closes = standing.isOwner && standing.others === 0;
  let numbers = 0;
  let balanceMinor = 0;
  let currency = 'NGN';
  if (closes) {
    const subs = await db.select({ id: schema.numberSubscriptions.id })
      .from(schema.numberSubscriptions)
      .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId),
                 isNull(schema.numberSubscriptions.cancelledAt)));
    numbers = subs.length;
    const w = await getOrCreateWallet(s.tenantId).catch(() => null);
    balanceMinor = w?.balanceMinor ?? 0;
    currency = w?.currency || 'NGN';
  }

  return {
    workspaceName: tenant?.name || '',
    // What will happen, named rather than implied.
    outcome: !standing.isOwner ? 'account_only'
      : standing.others === 0 ? 'closes_workspace'
      : 'transfer_first',
    otherMembers: standing.others,
    otherOwners: standing.otherOwners,
    numbers, balanceMinor, currency
  };
});
