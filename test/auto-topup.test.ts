import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema } from '../server/db';
import { encrypt } from '../server/utils/crypto';
import { AUTO_TOPUP_CONSENT_VERSION } from '../server/utils/auto-topup-attempts';
import { claimAutoTopupForCharge, settleAutoTopupObservation } from '../server/utils/auto-topup-executor';
import type { PaymentObservation } from '../server/utils/auto-topup-provider';
import { debitInTransaction, walletCreditVatMinor } from '../server/utils/wallet';
import { sendPaymentReceivedEmail } from '../server/utils/email';

vi.mock('../server/utils/email', () => ({
  sendPaymentReceivedEmail: vi.fn(),
  sendAutoTopupFailedEmail: vi.fn()
}));

// Financial integration tests must never fall back to DATABASE_URL. The suite
// only runs against an explicitly selected, migrated database ending in _test.
const url = process.env.AUTO_TOPUP_TEST_DATABASE_URL;

it('applies the same inclusive NGN VAT to automatic and manual top-ups', () => {
  const amountMinor = 1_000_000;
  const automaticVat = walletCreditVatMinor('NGN', 'auto_topup', amountMinor);
  expect(automaticVat).toBeGreaterThan(0);
  expect(automaticVat).toBe(walletCreditVatMinor('NGN', 'manual_topup', amountMinor));
});

describe.skipIf(!url)('auto top-up critical money-safety flow', { timeout: 30_000 }, () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let tenantId: string;
  let userId: string;

  beforeAll(() => {
    if (!url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error('AUTO_TOPUP_TEST_DATABASE_URL must name a dedicated database ending in _test');
    }
    client = postgres(url, { max: 8, connect_timeout: 5 });
    db = drizzle(client, { schema });
    const encryptionKey = randomBytes(32).toString('base64');
    vi.stubGlobal('useRuntimeConfig', () => ({ encryptionKey }));
    vi.stubGlobal('createError', (input: { message?: string }) =>
      Object.assign(new Error(input.message), input));
  });

  afterAll(async () => {
    if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (client) await client.end();
    vi.unstubAllGlobals();
  }, 30_000);

  it('queues, dispatches, credits and notifies exactly once despite concurrent duplicates', async () => {
    tenantId = randomUUID();
    const email = `auto-topup-${tenantId}@example.invalid`;

    const [user] = await db.insert(schema.users).values({ email }).returning();
    userId = user!.id;
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Auto top-up integration test',
      slug: `auto-topup-test-${tenantId}`,
      sandboxMode: false
    });
    await db.insert(schema.memberships).values({ tenantId, userId, role: 'owner' });
    await db.insert(schema.wallets).values({ tenantId, currency: 'USD', balanceMinor: 600 });
    const [card] = await db.insert(schema.paymentMethods).values({
      tenantId,
      provider: 'stripe',
      tokenEnc: encrypt('pm_test'),
      providerCustomerId: 'cus_test',
      reusable: true,
      expMonth: 12,
      expYear: 2099,
      updatedAt: new Date('2020-01-01')
    }).returning();
    await db.insert(schema.autoTopupSettings).values({
      tenantId,
      paymentMethodId: card!.id,
      enabled: true,
      thresholdMinor: 500,
      topupAmountMinor: 2000,
      consentVersion: AUTO_TOPUP_CONSENT_VERSION,
      consentedAt: new Date(),
      consentedByUserId: userId,
      consentedByEmail: email
    });

    // Spending crosses $5.00, so the debit and its durable top-up request must
    // commit together.
    const debit = await db.transaction(tx => debitInTransaction(tx, {
      tenantId,
      amountMinor: 200,
      reason: 'test_usage',
      reference: `critical-debit-${tenantId}`
    }));
    expect(debit.balanceMinor).toBe(400);
    expect(debit.autoTopupAttemptId).toBeTruthy();

    // Avoid making the test depend on the database and Node clocks agreeing to
    // the millisecond when the queue row is created.
    await db.update(schema.autoTopupAttempts)
      .set({ nextAttemptAt: new Date('2020-01-01') })
      .where(eq(schema.autoTopupAttempts.id, debit.autoTopupAttemptId!));

    // Five workers race for the same work; only one may receive permission to
    // make the provider charge.
    const claims = await Promise.all(Array.from({ length: 5 }, () =>
      claimAutoTopupForCharge(tenantId, debit.autoTopupAttemptId!, {
        mode: 'test',
        fingerprint: 'critical-flow-test-key'
      }, db)));
    expect(claims.filter(result => result.status === 'dispatch')).toHaveLength(1);

    const [attempt] = await db.select().from(schema.autoTopupAttempts)
      .where(eq(schema.autoTopupAttempts.id, debit.autoTopupAttemptId!));
    expect(attempt?.status).toBe('dispatching');

    // Five duplicate success callbacks represent webhook retries and a worker
    // response arriving together. The wallet and customer email still change once.
    const observation: PaymentObservation = {
      outcome: 'succeeded',
      provider: 'stripe',
      providerId: `pi_${tenantId}`,
      reference: attempt!.idempotencyKey,
      amountMinor: 2000,
      currency: 'USD',
      mode: 'test',
      code: 'stripe_succeeded'
    };
    await Promise.all(Array.from({ length: 5 }, () =>
      settleAutoTopupObservation(observation, db)));

    const [wallet] = await db.select().from(schema.wallets)
      .where(eq(schema.wallets.tenantId, tenantId));
    const credits = await db.select().from(schema.ledger).where(and(
      eq(schema.ledger.reference, attempt!.idempotencyKey),
      eq(schema.ledger.kind, 'credit')
    ));
    const payments = await db.select().from(schema.payments)
      .where(eq(schema.payments.reference, attempt!.idempotencyKey));
    const [settledAttempt] = await db.select().from(schema.autoTopupAttempts)
      .where(eq(schema.autoTopupAttempts.id, attempt!.id));

    expect(wallet?.balanceMinor).toBe(2400);
    expect(credits).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('succeeded');
    expect(settledAttempt?.status).toBe('succeeded');
    expect(sendPaymentReceivedEmail).toHaveBeenCalledTimes(1);
  });
});
