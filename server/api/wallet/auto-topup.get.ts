// GET /api/wallet/auto-topup -> current configuration and whether this
// workspace has everything required to enable it.
import { requireTenantManager } from '~/server/utils/api';
import { autoTopupResponse, getAutoTopupState } from '~/server/utils/auto-topup';
import { useDb, schema } from '~/server/db';
import { desc, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const db = useDb();
  const [state, attempts] = await Promise.all([
    getAutoTopupState(s.tenantId, db),
    db.select({
      status: schema.autoTopupAttempts.status,
      reference: schema.autoTopupAttempts.idempotencyKey,
      failureCode: schema.autoTopupAttempts.failureCode,
      amountMinor: schema.autoTopupAttempts.amountMinor,
      currency: schema.autoTopupAttempts.currency,
      createdAt: schema.autoTopupAttempts.createdAt,
      updatedAt: schema.autoTopupAttempts.updatedAt
    }).from(schema.autoTopupAttempts)
      .where(eq(schema.autoTopupAttempts.tenantId, s.tenantId))
      .orderBy(desc(schema.autoTopupAttempts.createdAt))
      .limit(1)
  ]);
  return { ...autoTopupResponse(state), lastAttempt: attempts[0] ?? null };
});
