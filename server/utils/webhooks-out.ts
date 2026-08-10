// server/utils/webhooks-out.ts
// Telling a client about their own traffic.
//
// Everything here is shaped by volume. At a few million calls a month, the
// obvious implementation — post to their URL as each call ends, retry until it
// works — would have us holding open thousands of sockets against somebody
// else's slow server and storing a row for every event forever. So:
//
//   · they subscribe to specific events, not to everything
//   · nothing is sent inline; a call finishing enqueues and moves on
//   · four attempts over roughly an hour, then we stop
//   · an endpoint that fails twenty times running is switched off and they're told
//   · records older than thirty days are deleted
//
// The last two matter most: without them, one broken integration generates
// continuous outbound load for as long as nobody notices.
import { and, eq, lte, lt, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { createHmac } from 'node:crypto';

const MAX_ATTEMPTS = 4;
const BACKOFF_MINUTES = [1, 5, 20, 60];
const DISABLE_AFTER = 20;
const RETAIN_DAYS = 30;
const TIMEOUT_MS = 8000;

/** Queue an event for whoever asked to hear about it. Returns immediately —
 *  the caller is usually finishing a call and must not wait. */
export async function emitWebhook(tenantId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const db = useDb();
    const eps = await db.select().from(schema.webhookEndpoints)
      .where(and(eq(schema.webhookEndpoints.tenantId, tenantId), eq(schema.webhookEndpoints.enabled, true)));
    if (!eps.length) return;

    const rows = eps
      .filter((e) => (e.events || []).includes(eventType))
      .map((e) => ({ endpointId: e.id, tenantId, eventType, payload }));
    if (!rows.length) return;

    await db.insert(schema.webhookDeliveries).values(rows);
  } catch (e: any) {
    // A webhook nobody receives is a smaller problem than a call that failed to
    // finish because we couldn't queue one.
    console.error('[webhooks-out] could not enqueue:', e?.message);
  }
}

export interface DispatchResult { attempted: number; delivered: number; failed: number; disabled: number; pruned: number; }

/** Send what's due. Called by the scheduler; bounded per run so a backlog can't
 *  monopolise an instance that also has calls to route. */
export async function dispatchWebhooks(limit = 200): Promise<DispatchResult> {
  const db = useDb();
  const out: DispatchResult = { attempted: 0, delivered: 0, failed: 0, disabled: 0, pruned: 0 };
  const now = new Date();

  const due = await db.select().from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.status, 'pending'), lte(schema.webhookDeliveries.nextAttemptAt, now)))
    .limit(limit);

  for (const d of due) {
    const [ep] = await db.select().from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, d.endpointId)).limit(1);
    if (!ep || !ep.enabled) {
      await db.update(schema.webhookDeliveries)
        .set({ status: 'failed', responseExcerpt: 'endpoint removed or disabled' })
        .where(eq(schema.webhookDeliveries.id, d.id));
      continue;
    }

    out.attempted++;
    const body = JSON.stringify({ event: d.eventType, created_at: d.createdAt, data: d.payload });

    // Signed so they can tell a real delivery from anything else pointed at
    // their URL. The secret is theirs; we never send it.
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'Telroi-Webhooks/1' };
    if (ep.secretEnc) {
      try {
        const { decrypt } = await import('~/server/utils/crypto');
        const secret = decrypt(ep.secretEnc);
        headers['telroi-signature'] = createHmac('sha256', secret).update(body).digest('hex');
      } catch { /* unsigned rather than undelivered */ }
    }

    let status = 0;
    let excerpt = '';
    try {
      const res = await fetch(ep.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = res.status;
      excerpt = (await res.text().catch(() => '')).slice(0, 300);
    } catch (e: any) {
      excerpt = e?.name === 'TimeoutError' ? `no response within ${TIMEOUT_MS / 1000}s` : (e?.message || 'request failed');
    }

    const ok = status >= 200 && status < 300;
    const attempts = d.attempts + 1;

    if (ok) {
      await db.update(schema.webhookDeliveries).set({
        status: 'delivered', attempts, responseStatus: status, responseExcerpt: excerpt, deliveredAt: new Date()
      }).where(eq(schema.webhookDeliveries.id, d.id));
      await db.update(schema.webhookEndpoints).set({ consecutiveFailures: 0 })
        .where(eq(schema.webhookEndpoints.id, ep.id));
      out.delivered++;
      continue;
    }

    const giveUp = attempts >= MAX_ATTEMPTS;
    await db.update(schema.webhookDeliveries).set({
      status: giveUp ? 'failed' : 'pending',
      attempts,
      responseStatus: status || null,
      responseExcerpt: excerpt,
      nextAttemptAt: new Date(Date.now() + (BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] * 60000))
    }).where(eq(schema.webhookDeliveries.id, d.id));
    if (giveUp) out.failed++;

    const failures = (ep.consecutiveFailures || 0) + 1;
    if (failures >= DISABLE_AFTER) {
      // One broken integration would otherwise generate outbound load forever.
      await db.update(schema.webhookEndpoints).set({
        enabled: false, consecutiveFailures: failures,
        disabledReason: `Switched off after ${DISABLE_AFTER} consecutive failures — last response: ${excerpt || status}`
      }).where(eq(schema.webhookEndpoints.id, ep.id));
      out.disabled++;
    } else {
      await db.update(schema.webhookEndpoints).set({ consecutiveFailures: failures })
        .where(eq(schema.webhookEndpoints.id, ep.id));
    }
  }

  // Old records go. A developer debugging needs last week.
  try {
    const cutoff = new Date(Date.now() - RETAIN_DAYS * 86400000);
    const res: any = await db.delete(schema.webhookDeliveries)
      .where(lt(schema.webhookDeliveries.createdAt, cutoff));
    out.pruned = res?.rowCount || 0;
  } catch (e: any) { console.error('[webhooks-out] prune failed:', e?.message); }

  return out;
}
