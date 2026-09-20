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

  // Nigerian carriers do not charge us to receive a call, so a client should
  // not be charged a minute we never paid for. Their AI usage is metered
  // separately and is unaffected — that cost is real whoever placed the call.
  //
  // Carrier calls only. A Live Call from the website never touches a carrier,
  // so there is no minute to waive and nothing changes for it.
  // source carries the direction here, not direction — the callers pass it
  // that way and have since the webhook was the only one reaching this.
  const inbound = opts.source === 'inbound' || opts.direction === 'inbound';
  // The carrier, not the number. A call that arrived on Ruach, Kasooko or
  // Sotel is Nigerian inbound by definition — and the dialled number does not
  // reach this function, while reading the caller's instead would waive a
  // Nigerian caller to a US line, which is a call we do pay for.
  const NG_CARRIERS = ['ruach', 'kasooko', 'sotel'];
  const ngCarrier = NG_CARRIERS.includes(String(opts.provider || '').toLowerCase());
  if (inbound && opts.source !== 'live_call' && ngCarrier) {
    console.log(`[billing] inbound to a Nigerian number — no carrier minute charged (${opts.callId}, ${seconds}s)`);
    return { charged: 0, skipped: 'inbound_ng_free' };
  }

  const wallet = await getOrCreateWallet(opts.tenantId);
  const pricing = await getPricing(opts.tenantId);
  const amount = voiceCostMinor(seconds, wallet.currency as any, pricing.ngnPerUsd, pricing.voiceMinuteUsdMicro);
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
