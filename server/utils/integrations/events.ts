// server/utils/integrations/events.ts
// Fan-out of Telroi events to connected integrations:
//   • Outbound event subscriptions (Zapier / generic webhooks) — POST the event
//     payload to each subscribed target URL. This powers Zapier triggers.
//   • CRM call logging — when a call completes, log it onto the matching record
//     in every connected CRM that has a credential.
// All dispatch is best-effort and never throws into the caller (a failing
// integration must not break a call or a CRM write).
import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { useDb, schema } from '../../db';
import { decrypt } from '../crypto';
import { adapterFor, type CallLogInput } from './providers';

export type TelroiEvent =
  | 'call.completed' | 'call.missed' | 'call.started'
  | 'voicemail.received' | 'contact.created' | 'sms.received';

// POST an event to all active subscriptions for this tenant+event.
export async function dispatchEvent(tenantId: string, event: TelroiEvent, payload: Record<string, any>): Promise<void> {
  try {
    const db = useDb();
    const subs = await db.select().from(schema.integrationEvents)
      .where(and(eq(schema.integrationEvents.tenantId, tenantId), eq(schema.integrationEvents.event, event), eq(schema.integrationEvents.active, true)));
    if (!subs.length) return;
    const body = JSON.stringify({ event, tenantId, firedAt: new Date().toISOString(), data: payload });
    await Promise.allSettled(subs.map(async (sub) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Telroi-Events/1.0' };
      if (sub.secretEnc) {
        try { const secret = decrypt(sub.secretEnc); headers['X-Telroi-Signature'] = crypto.createHmac('sha256', secret).update(body).digest('hex'); } catch { /* */ }
      }
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 10000);
        await fetch(sub.targetUrl, { method: 'POST', headers, body, signal: ctrl.signal }).finally(() => clearTimeout(to));
        await db.update(schema.integrationEvents).set({ lastFiredAt: new Date() }).where(eq(schema.integrationEvents.id, sub.id));
      } catch (e) { console.error(`[events] ${event} -> ${sub.provider} failed`, e); }
    }));
  } catch (e) { console.error('[events] dispatch failed', e); }
}

// Log a completed call into every connected CRM (import-direction call sync, and
// the embed panel's "log this call" both route through here).
export async function logCallToCrms(tenantId: string, call: CallLogInput): Promise<void> {
  try {
    const db = useDb();
    const conns = await db.select().from(schema.integrations)
      .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.status, 'connected')));
    await Promise.allSettled(conns.map(async (c) => {
      if (c.provider === 'zapier') return; // not a CRM
      const adapter = adapterFor(c.provider);
      if (!adapter || !c.credentialsEnc) return;
      let creds: any; try { creds = JSON.parse(decrypt(c.credentialsEnc)); } catch { return; }
      try { const { ensureValidCreds } = await import('./tokens'); creds = await ensureValidCreds(c.id, c.provider, creds); } catch { return; }
      try { await adapter.logCall(creds, call); }
      catch (e: any) {
        await db.update(schema.integrations).set({ lastSyncError: String(e?.message || e).slice(0, 300) }).where(eq(schema.integrations.id, c.id));
        console.error(`[events] logCall -> ${c.provider} failed`, e);
      }
    }));
  } catch (e) { console.error('[events] logCallToCrms failed', e); }
}

// Screen-pop / click-to-call lookup: ask each connected CRM who owns this number.
// Returns the first match (used by the embed panel + inbound screen-pop).
export async function lookupCallerInCrms(tenantId: string, phone: string) {
  const db = useDb();
  const conns = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.status, 'connected')));
  for (const c of conns) {
    if (c.provider === 'zapier') continue;
    const adapter = adapterFor(c.provider);
    if (!adapter || !c.credentialsEnc) continue;
    let creds: any; try { creds = JSON.parse(decrypt(c.credentialsEnc)); } catch { continue; }
    try { const { ensureValidCreds } = await import('./tokens'); creds = await ensureValidCreds(c.id, c.provider, creds); } catch { continue; }
    try { const hit = await adapter.findByPhone(creds, phone); if (hit) return { provider: c.provider, contact: hit }; }
    catch { /* try next */ }
  }
  return null;
}
