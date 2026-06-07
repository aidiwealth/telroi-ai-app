// server/api/webhooks/telroi.post.ts
// Receiver for Telroi -> CRM push commands (history, event, contact, rating).
// Verifies crm_token against the tenant, ingests call events.
// NOTE: This is a server-to-server endpoint; it is intentionally public
// (no user session) but authenticated by the per-tenant crm_token.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event);
  const token = body?.crm_token;
  if (!token) throw createError({ statusCode: 401, message: 'Missing crm_token' });

  const db = useDb();
  // Find the tenant whose decrypted Telroi key matches the token.
  // DECISION: small tenant counts make a scan acceptable; for scale, store a
  // separate indexed hash of the crm_token.
  const tenants = await db.select().from(schema.tenants);
  const tenant = tenants.find((t) => {
    if (!t.telroiApiKeyEnc) return false;
    try { return decrypt(t.telroiApiKeyEnc) === token; } catch { return false; }
  });
  if (!tenant) throw createError({ statusCode: 401, message: 'Invalid crm_token' });

  const cmd = body.cmd as string;

  if (cmd === 'contact') {
    // CPBX asks who the caller is. Return a contact card if we know them.
    // BUILD: look up CRM contact by body.phone. Stub returns empty.
    return { contact_name: '', responsible: '' };
  }

  if (cmd === 'history' || cmd === 'event' || cmd === 'rating') {
    await db.insert(schema.callEvents).values({
      tenantId: tenant.id,
      callid: String(body.callid ?? body.uid ?? ''),
      type: body.type ?? cmd,
      direction: body.direction ?? body.type ?? null,
      phone: body.phone ?? null,
      user: body.user ?? null,
      status: body.status ?? null,
      startedAt: body.start ? parseTelroiDate(body.start) : new Date(),
      duration: numOrNull(body.duration),
      wait: numOrNull(body.wait),
      rating: numOrNull(body.rating),
      recordingUrl: body.link ?? null,
      raw: body
    });

    // Compact call-log entry (separate from the full call_events row) for the
    // operator Logs view; auto-expires after 60 days.
    if (cmd === 'history') {
      const dir = body.direction ?? body.type ?? 'call';
      const dur = numOrNull(body.duration);
      await logEvent({
        tenantId: tenant.id, kind: 'call', action: `call.${dir}`,
        summary: `${body.phone || 'unknown'} · ${body.status || 'completed'}${dur ? ` · ${dur}s` : ''}`,
        ref: String(body.callid ?? body.uid ?? '')
      });
    }

    // Charge airtime on a completed call (duration > 0). Idempotent by callid so
    // a webhook retry never double-charges. Hard-stops at zero via debit().
    const duration = numOrNull(body.duration);
    if (cmd === 'history' && duration && duration > 0) {
      try {
        const { getOrCreateWallet, debit } = await import('~/server/utils/wallet');
        const { getPricing, voiceCostMinor } = await import('~/server/utils/pricing');
        const wallet = await getOrCreateWallet(tenant.id);
        const pricing = await getPricing();
        const cost = voiceCostMinor(duration, wallet.currency as 'NGN' | 'USD', pricing.ngnPerUsd);
        await debit({
          tenantId: tenant.id, amountMinor: cost, reason: 'voice_minute',
          reference: `call_${body.callid ?? body.uid}`,
          meta: { seconds: duration, callid: body.callid ?? body.uid }
        });
      } catch (e) {
        // Billing failure must not break event ingestion; log and continue.
        // (Insufficient funds is surfaced when the customer next checks the wallet.)
        console.error('airtime debit failed:', (e as any)?.message || e);
      }
    }
  }

  return { ok: true };
});

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// CPBX format: YYYYmmddTHHMMSSZ
function parseTelroiDate(s: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(+d) ? new Date() : d; }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}
