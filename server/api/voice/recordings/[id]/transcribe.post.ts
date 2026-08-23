// POST /api/voice/recordings/:id/transcribe
//
// Turns a recording into text. Charged per minute of audio, because unlike
// storing a recording this costs real money every time — and most recordings are
// never read, so doing it on request rather than automatically is what keeps the
// feature affordable.
//
// The work happens in the background and the answer returns immediately.
// Fetching a megabyte from storage, posting it to a speech vendor and waiting
// for a reply outlives the gateway's patience: a thirty-six second recording was
// enough to prove that, and a ten-minute one never had a chance. The client
// polls transcriptStatus, which is what that column has always been for.
//
// The audio goes to the vendor as bytes rather than a signed URL, because a
// recording is somebody's private conversation and a signed link is one anybody
// holding it can fetch without authenticating.
import { and, eq, sql } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';
import { sttTranscribe } from '~/server/utils/voice/ai-brain';
import { getPricing, toCurrencyMinor } from '~/server/utils/pricing';
import { debit, getOrCreateWallet, canSpend } from '~/server/utils/wallet';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (!(await hasFeature(s.tenantId, 'recording'))) {
    throw apiError('feature_locked', 'Transcription is part of call recording on your plan.', 402);
  }

  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [rec] = await db.select().from(schema.callRecordings)
    .where(and(eq(schema.callRecordings.id, id), eq(schema.callRecordings.tenantId, s.tenantId)))
    .limit(1);
  if (!rec) throw apiError('not_found', 'No such recording', 404);
  if (rec.transcript) return { ok: true, status: 'done', transcript: rec.transcript };
  if (rec.transcriptStatus === 'running') return { ok: true, status: 'running' };

  if (!rec.objectKey || rec.status === 'expired') {
    throw apiError('expired', 'That recording is past its retention and the audio is gone.', 410);
  }

  // Duration is what this is charged by. A few recordings have none — calls that
  // connected and dropped — so where it is missing but the file is substantial,
  // estimate from the size: 8kHz 16-bit mono is about 16KB a second.
  const seconds = rec.durationSeconds || (rec.sizeBytes ? Math.round(rec.sizeBytes / 16000) : 0);
  if (seconds < 1) {
    throw apiError('too_short', 'There is not enough audio in that recording to transcribe.', 400);
  }

  const wallet = await getOrCreateWallet(s.tenantId);
  const pricing: any = await getPricing(s.tenantId);
  const perMinuteMicro = Number(pricing?.transcriptionMinuteUsdMicro) || 20000;   // $0.02
  const usdMinor = Math.max(1, Math.round((perMinuteMicro * (seconds / 60)) / 10000));
  const costMinor = toCurrencyMinor(usdMinor, wallet.currency as any, Number(pricing?.ngnPerUsd) || 1600);

  const [t] = await db.select({
    postpaid: schema.tenants.postpaid,
    creditLimitMinor: schema.tenants.creditLimitMinor,
    billingSuspendedAt: schema.tenants.billingSuspendedAt
  }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  if (!canSpend(t, wallet.balanceMinor, costMinor)) {
    throw apiError('insufficient', 'Not enough in your wallet to transcribe this recording.', 402);
  }

  // The agent behind this number, in one lookup: its language, its speech
  // connection and whether it is managed all come from the same row.
  //
  // Matched on the last ten digits, because a recording stores 2085910037 where
  // the subscription holds +2342085910037 — an exact match would find nothing
  // and quietly transcribe a Yoruba call as English.
  let language = 'en';
  let sttConnId: string | null = null;
  let allowManaged = false;
  try {
    // Telnyx recordings arrive with no number of their own, so fall back to the
    // call log — which does know which of our numbers the call came in on.
    // Without this the lookup found nothing, no speech connection was resolved,
    // and every Telnyx recording reported "no speech" without a vendor ever
    // being asked.
    let telnum = rec.telnum || '';
    if (!telnum) {
      // call_events has no column for the number called — `phone` is the
      // caller's. The one we own is kept in the raw webhook payload as `to`.
      const [ev] = await db.select({ raw: schema.callEvents.raw })
        .from(schema.callEvents)
        .where(and(eq(schema.callEvents.tenantId, s.tenantId), eq(schema.callEvents.callid, rec.callid)))
        .limit(1);
      telnum = String((ev?.raw as any)?.to || '');
    }

    const digits = telnum.replace(/\D/g, '').slice(-10);
    if (digits) {
      const [sub] = await db.select({ agentId: schema.numberSubscriptions.routeAgentId })
        .from(schema.numberSubscriptions)
        .where(and(
          eq(schema.numberSubscriptions.tenantId, s.tenantId),
          sql`right(regexp_replace(${schema.numberSubscriptions.telnum}, '\\D', '', 'g'), 10) = ${digits}`
        )).limit(1);
      if (sub?.agentId) {
        const [agent] = await db.select({
          language: schema.aiAgents.language,
          sttConnId: schema.aiAgents.sttConnId,
          tier: schema.aiAgents.tier
        }).from(schema.aiAgents).where(eq(schema.aiAgents.id, sub.agentId)).limit(1);
        if (agent?.language) language = agent.language;
        sttConnId = agent?.sttConnId || null;
        allowManaged = agent?.tier === 'managed';
      }
    }
  } catch { /* English and no connection is a reasonable default, not a failure */ }

  await db.update(schema.callRecordings).set({ transcriptStatus: 'running' })
    .where(eq(schema.callRecordings.id, rec.id));

  void runTranscription({
    recordingId: rec.id, objectKey: rec.objectKey, callid: rec.callid,
    tenantId: s.tenantId, seconds, costMinor, language, sttConnId, allowManaged
  });

  return { ok: true, status: 'running', costMinor, currency: wallet.currency };
});

/** The work itself. Never throws at the caller: the request has already
 *  returned, so a failure has to be recorded rather than raised. */
async function runTranscription(o: {
  recordingId: string; objectKey: string; callid: string; tenantId: string;
  seconds: number; costMinor: number; language: string;
  sttConnId: string | null; allowManaged: boolean;
}) {
  const db = useDb();
  const fail = async (why: string) => {
    console.error('[transcribe]', o.recordingId, why);
    await db.update(schema.callRecordings).set({ transcriptStatus: 'failed' })
      .where(eq(schema.callRecordings.id, o.recordingId)).catch(() => undefined);
  };

  let audio: { body: Buffer; contentType: string };
  try {
    audio = await getObject(o.objectKey);
  } catch (e: any) {
    return fail(`audio unreadable: ${e?.message}`);
  }

  let text = '';
  try {
    text = await sttTranscribe(o.tenantId, o.sttConnId, audio.body, audio.contentType || 'audio/wav', o.allowManaged, o.language);
  } catch (e: any) {
    return fail(`vendor error: ${e?.message}`);
  }

  // An empty result is the vendor finding nothing worth returning — silence, or
  // text it recognised as its own hallucination. Not charged for.
  if (!text) return fail('no speech returned');

  await db.update(schema.callRecordings)
    .set({ transcript: text, transcriptStatus: 'done' })
    .where(eq(schema.callRecordings.id, o.recordingId));

  // Charged after the text is safely stored: a failed debit leaves the client
  // with their transcript and us out a fraction of a penny, which is the right
  // way round.
  try {
    const { isSandbox } = await import('~/server/utils/sandbox');
    const sandboxed = await isSandbox(o.tenantId).catch(() => false);
    if (sandboxed) {
      const { sandboxLedgerEntry } = await import('~/server/utils/wallet');
      await sandboxLedgerEntry({
        tenantId: o.tenantId, amountMinor: o.costMinor, reason: 'transcription',
        reference: `sbx_tr_${o.recordingId}`, meta: { callid: o.callid, seconds: o.seconds }
      });
    } else {
      await debit({
        tenantId: o.tenantId, amountMinor: o.costMinor, reason: 'transcription',
        reference: `tr_${o.recordingId}`, meta: { callid: o.callid, seconds: o.seconds }
      });
    }
  } catch (e: any) {
    console.error('[transcribe] stored but not charged:', o.recordingId, e?.message);
  }
}
