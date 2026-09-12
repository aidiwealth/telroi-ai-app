// DELETE /api/wallet/auto-topup -> disable charging but retain the amounts so
// the owner can turn it back on without re-entering the configuration.
import { eq } from 'drizzle-orm';
import { requireTenantOwner } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { autoTopupResponse, getAutoTopupState } from '~/server/utils/auto-topup';
import { logEvent } from '~/server/utils/logs';
import { cancelUnsentAutoTopups } from '~/server/utils/auto-topup-attempts';

export default defineEventHandler(async (event) => {
  const s = await requireTenantOwner(event);
  const db = useDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.select({ id: schema.wallets.id }).from(schema.wallets)
      .where(eq(schema.wallets.tenantId, s.tenantId)).for('update').limit(1);
    await tx.update(schema.autoTopupSettings)
      .set({ enabled: false, updatedAt: now })
      .where(eq(schema.autoTopupSettings.tenantId, s.tenantId));
    await cancelUnsentAutoTopups(tx, s.tenantId, 'auto_topup_disabled');
  });

  await logEvent({
    tenantId: s.tenantId,
    kind: 'system',
    action: 'auto_topup.disabled',
    summary: 'Disabled automatic wallet top-ups'
  });

  return autoTopupResponse(await getAutoTopupState(s.tenantId));
});
