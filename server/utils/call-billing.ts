// server/utils/call-billing.ts
// Meters a completed call and charges the correct wallet:
//   - support workspace calls -> support wallet
//   - client calls -> that client's wallet, on their assigned vendor
// In sandbox, records a sandbox ledger entry (no real debit). Idempotent per call.
import { getPricing, voiceCostMinor } from './pricing';
import { getOrCreateWallet, debit, sandboxLedgerEntry } from './wallet';
import { isSandbox } from './sandbox';

export async function chargeCall(opts: {
  tenantId: string;
  callId: string;          // unique call id (idempotency key)
  seconds: number;         // billable duration
  provider?: string;       // digidite | telnyx | twilio (for the ledger note)
  source?: string;         // 'live_call' | 'dialer'
  phone?: string;          // other party (for CRM logging / Zapier — optional)
  direction?: 'inbound' | 'outbound';
  outcome?: string;
  startedAt?: Date;
  recordingUrl?: string;
}) {
  const seconds = Math.max(0, Math.floor(opts.seconds || 0));
  if (seconds === 0) return { charged: 0, skipped: 'zero_duration' };

  const wallet = await getOrCreateWallet(opts.tenantId);
  const pricing = await getPricing(opts.tenantId);
  const amount = voiceCostMinor(seconds, wallet.currency as any, pricing.ngnPerUsd);
  const reference = `call_${opts.callId}`;
  const meta = { provider: opts.provider, source: opts.source, seconds };

  // Fire integrations (Zapier event + CRM call logging) for completed calls.
  // Best-effort and fire-and-forget so it never blocks or breaks billing.
  if (opts.phone) {
    const detail = {
      phone: opts.phone, direction: opts.direction || 'outbound', durationSec: seconds,
      outcome: opts.outcome, startedAt: opts.startedAt || new Date(), recordingUrl: opts.recordingUrl
    };
    import('./integrations/events').then(({ dispatchEvent, logCallToCrms }) => {
      dispatchEvent(opts.tenantId, 'call.completed', { ...detail, startedAt: detail.startedAt.toISOString(), provider: opts.provider, source: opts.source });
      logCallToCrms(opts.tenantId, detail);
    }).catch((e) => console.error('[chargeCall] integration dispatch failed', e));
  }

  // Sandbox: record what it WOULD cost, don't touch the balance.
  if (await isSandbox(opts.tenantId)) {
    await sandboxLedgerEntry({ tenantId: opts.tenantId, amountMinor: amount, reason: 'voice_minute', reference: `sbx_${reference}`, meta });
    return { charged: 0, simulated: amount, currency: wallet.currency, sandbox: true };
  }

  const res = await debit({ tenantId: opts.tenantId, amountMinor: amount, reason: 'voice_minute', reference, meta });
  return { charged: amount, currency: wallet.currency, balanceMinor: res.balanceMinor, idempotent: (res as any).idempotent };
}
