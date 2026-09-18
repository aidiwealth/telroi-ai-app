// server/utils/voice/notify-service.ts
// Voice notifications: a call that speaks a message the client wrote.
//
// Not a parameter on the OTP path. OTP plays pre-recorded files and reads the
// digits from Asterisk's own sound files, so the code never leaves the machine
// and a hundred thousand calls cost nothing beyond carrier minutes. Free text
// cannot work that way — every message is different, so every one is
// synthesised, and the cost profile is different enough to bill separately.
//
// It also carries a different obligation. A verification call is expected by
// whoever answers: they asked for it seconds earlier. A notification is not,
// which puts it closer to outbound campaigning than to verification, and the
// same rate limits and number-use rules apply.
import { useDb, schema } from '~/server/db';
// gte rather than a raw comparison: interpolating a Date into sql`` hands
// the driver an object it cannot bind, which threw on the first request.
import { and, eq, gte, sql } from 'drizzle-orm';
import { placeNotifyCall } from './vendors';

export interface NotifyResult {
  ok: boolean;
  id?: string;
  error?: string;
  retryAfterSeconds?: number;
}

// Long enough for a delivery update or an appointment reminder, short enough
// that one request cannot synthesise a novel or hold a carrier minute open
// reading it out. About ninety seconds of speech.
export const MAX_NOTIFY_CHARS = 900;

/** Rate limits, deliberately tighter than OTP's.
 *
 *  A verification call is expected: somebody asked for it seconds earlier and
 *  wants it to arrive. A notification is not, so the same volume that is normal
 *  for one is a nuisance for the other — and an endpoint that speaks arbitrary
 *  text to arbitrary numbers is a telemarketing tool if it is not bounded. */
const COOLDOWN_SECONDS = 20;   // to the same number
const PER_HOUR = 5;            // to the same number
const TENANT_PER_HOUR = 200;   // across the workspace

async function checkRate(tenantId: string, toNumber: string): Promise<{ ok: boolean; retryAfter?: number; reason?: string }> {
  const db = useDb();
  const now = Date.now();
  const since = (secs: number) => new Date(now - secs * 1000);

  const [last] = await db.select({ createdAt: schema.voiceNotifications.createdAt })
    .from(schema.voiceNotifications)
    .where(and(eq(schema.voiceNotifications.tenantId, tenantId),
               eq(schema.voiceNotifications.toNumber, toNumber)))
    .orderBy(sql`${schema.voiceNotifications.createdAt} DESC`).limit(1);
  if (last) {
    const sinceLast = (now - new Date(last.createdAt).getTime()) / 1000;
    if (sinceLast < COOLDOWN_SECONDS) {
      return { ok: false, retryAfter: Math.ceil(COOLDOWN_SECONDS - sinceLast), reason: 'cooldown' };
    }
  }

  const [{ c: perNumber }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(schema.voiceNotifications)
    .where(and(eq(schema.voiceNotifications.tenantId, tenantId),
               eq(schema.voiceNotifications.toNumber, toNumber),
               gte(schema.voiceNotifications.createdAt, since(3600))));
  if (perNumber >= PER_HOUR) return { ok: false, retryAfter: 3600, reason: 'per_number_hourly' };

  // A workspace ceiling as well as a per-number one: five an hour to each of a
  // thousand numbers is still a thousand unsolicited calls.
  const [{ c: perTenant }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(schema.voiceNotifications)
    .where(and(eq(schema.voiceNotifications.tenantId, tenantId),
               gte(schema.voiceNotifications.createdAt, since(3600))));
  if (perTenant >= TENANT_PER_HOUR) return { ok: false, retryAfter: 3600, reason: 'workspace_hourly' };

  return { ok: true };
}

/**
 * Place a notification call.
 *
 * The order matters and is not the same as OTP's. A code is spoken from files
 * that already exist, so nothing is spent until the call is placed. A
 * notification has to be synthesised first, and the vendor bills that whether
 * or not anybody answers — so the speech is charged on acceptance and the call
 * time on hangup, which is what the client is told in the docs.
 */
export async function sendVoiceNotification(
  tenantId: string,
  toNumber: string,
  body: string
): Promise<NotifyResult> {
  const db = useDb();

  const text = (body || '').trim();
  if (!text) return { ok: false, error: 'empty_message' };
  if (text.length > MAX_NOTIFY_CHARS) return { ok: false, error: 'message_too_long' };

  const rate = await checkRate(tenantId, toNumber);
  if (!rate.ok) return { ok: false, error: `rate_limited:${rate.reason}`, retryAfterSeconds: rate.retryAfter };

  // A sandbox workspace never dials, for the same reason OTP does not: a trial
  // account with a live key would run up carrier minutes uncapped and unbilled.
  const { isSandbox } = await import('../sandbox');
  const sandboxed = await isSandbox(tenantId).catch(() => false);

  // Refused before synthesising rather than after: the speech costs us whether
  // or not the call connects, so a wallet that cannot cover the minimum should
  // stop us before we spend anything.
  if (!sandboxed) {
    const { getPricing, notifyCostMinor } = await import('../pricing');
    const { getOrCreateWallet, canSpend } = await import('../wallet');
    const { detectRegion } = await import('../regions');
    const known = ['NG', 'US', 'GB', 'CA'];
    const raw = detectRegion(toNumber);
    const region = known.includes(raw) && /^\+?(234|1|44)/.test(toNumber.replace(/[^\d+]/g, ''))
      ? raw : undefined;
    const pricing = await getPricing(tenantId, region);
    const wallet = await getOrCreateWallet(tenantId);
    // The minimum, since the call has not happened and a longer one costs more.
    // What this message will cost if the audio comes in under the ceiling.
    // The true count is resolved after synthesis, when the file can be
    // measured — this is the floor, and a wallet that cannot cover it should
    // stop us before we spend anything on speech.
    const floor = notifyCostMinor(text.length, undefined, wallet.currency as any, pricing.ngnPerUsd, pricing.voiceNotifyUnitUsdMicro);
    const [t] = await db.select({
      postpaid: schema.tenants.postpaid,
      creditLimitMinor: schema.tenants.creditLimitMinor,
      billingSuspendedAt: schema.tenants.billingSuspendedAt
    }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!canSpend(t, wallet.balanceMinor, floor)) return { ok: false, error: 'insufficient_funds' };
  }

  // Any of the workspace's own SIP endpoints will do: the dialplan looks up the
  // tenant's DID for the carrier from it, and every endpoint in a workspace
  // belongs to the same tenant.
  const [ep] = await db.select({ u: schema.sipEndpoints.sipUsername })
    .from(schema.sipEndpoints)
    .where(eq(schema.sipEndpoints.tenantId, tenantId)).limit(1);
  const sipEndpoint = ep?.u || '';

  const [row] = await db.insert(schema.voiceNotifications)
    .values({ tenantId, toNumber, body: text, status: 'queued', ttsChars: text.length })
    .returning();

  // A sandbox workspace gets a plausible id and no call, so a trial can build
  // against the endpoint without spending carrier minutes.
  const placed = sandboxed
    ? { ok: true as const, providerRef: `sbx_notify_${row.id}` }
    : await placeNotifyCall({ toNumber, notificationId: row.id, text, tenantId, sipEndpoint });

  if (!placed.ok) {
    await db.update(schema.voiceNotifications)
      .set({ status: 'failed', reason: placed.reason })
      .where(eq(schema.voiceNotifications.id, row.id));
    void import('../webhooks-out').then(({ emitWebhook }) => emitWebhook(tenantId, 'notification.failed', {
      id: row.id, to: toNumber, status: 'failed', reason: placed.reason
    })).catch(() => { /* best effort */ });
    return { ok: false, id: row.id, error: placed.reason };
  }

  // The measured duration, persisted now rather than at hangup: it is what the
  // unit count was resolved from, and a customer querying a two-unit charge
  // should be shown the audio length rather than told to trust it.
  const audioSeconds = (placed as any).durationSeconds || 0;
  await db.update(schema.voiceNotifications)
    .set({ status: 'dialing', callId: placed.providerRef, audioSeconds })
    .where(eq(schema.voiceNotifications.id, row.id));

  // The speech, charged now. The vendor billed us for synthesising it whether
  // or not anybody answers, so charging on answer would mean eating the cost of
  // every unanswered call. The call time is charged separately, on hangup.
  if (!sandboxed) {
    try {
      // The same path the AI agent uses, with only characters set. One cost
      // function rather than two: a second one computing the same thing is how
      // they drift, and the rate lives in pricing where an operator can see it.
      const { recordAiUsage } = await import('./ai-brain');
      await recordAiUsage({
        tenantId, agentId: null, callId: row.id, managed: true,
        usage: { sttSeconds: 0, llmInputTokens: 0, llmOutputTokens: 0, ttsChars: text.length }
      });
    } catch (e) {
      // Logged rather than fatal: a notification that went out unbilled for its
      // speech is a small loss, and refusing a call already placed is worse.
      console.error('[notify] tts not charged:', (e as Error)?.message);
    }
  }

  void import('../webhooks-out').then(({ emitWebhook }) => emitWebhook(tenantId, 'notification.queued', {
    id: row.id, to: toNumber, status: 'dialing'
  })).catch(() => { /* a webhook nobody gets beats a call that didn't finish */ });

  return { ok: true, id: row.id };
}
