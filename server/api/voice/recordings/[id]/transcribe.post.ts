// POST /api/voice/recordings/:id/transcribe
//
// Turns a recording into text. Charged per minute of audio, because unlike
// storing a recording this costs real money on every use — and most recordings
// are never read, so doing it on request rather than automatically is what
// keeps the feature affordable.
//
// The audio goes to the vendor as bytes rather than a signed URL: a recording is
// somebody's private conversation, and a signed link is one that anybody holding
// it can fetch without authenticating.
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
  if (rec.transcript) return { ok: true, transcript: rec.transcript, alreadyDone: true };

  // The audio, not the row. A recording past its retention has had the object
  // deleted while the row remains, so this is where that surfaces.
  if (!rec.objectKey || rec.status === 'expired') {
    throw apiError('expired', 'That recording is past its retention and the audio is gone.', 410);
  }

  // Duration is what this is charged by, and a few recordings have none —
  // calls that connected and dropped, where there was nothing to record. Where
  // it is missing but the file is substantial, estimate from the size rather
  // than refuse: 8kHz 16-bit mono is about 16KB a second.
  const seconds = rec.durationSeconds
    || (rec.sizeBytes ? Math.round(rec.sizeBytes / 16000) : 0);
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

  await db.update(schema.callRecordings).set({ transcriptStatus: 'running' })
    .where(eq(schema.callRecordings.id, rec.id));

  let audio: { body: Buffer; contentType: string };
  try {
    audio = await getObject(rec.objectKey);
  } catch {
    await db.update(schema.callRecordings).set({ transcriptStatus: 'failed' })
      .where(eq(schema.callRecordings.id, rec.id));
    throw apiError('audio_missing', 'The audio for that recording could not be read.', 404);
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
    const digits = (rec.telnum || '').replace(/\D/g, '').slice(-10);
    if (digits) {
      const [sub] = await db.select({ agentId: schema.numberSubscriptions.agentId })
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

  // sttTranscribe is what live calls use: it resolves the connection, handles a
  // managed agent, and rejects the phantom text Deepgram invents on silence.
  // This endpoint had its own copy of that, which would have drifted.
  const text = await sttTranscribe(s.tenantId, sttConnId, audio.body, audio.contentType || 'audio/wav', allowManaged, language)
    .catch(() => '');
  const r = text
    ? { ok: true as const, transcript: text, reason: '' }
    : { ok: false as const, transcript: '', reason: 'There was no clear speech in that recording.' };

  if (!r.ok || !r.transcript) {
    await db.update(schema.callRecordings).set({ transcriptStatus: 'failed' })
      .where(eq(schema.callRecordings.id, rec.id));
    // Nothing charged: a failed transcription that took money would be a debit
    // and a refund on the client's statement for something they never received.
    throw apiError('failed', r.reason || 'That recording could not be transcribed.', 502);
  }

  await db.update(schema.callRecordings)
    .set({ transcript: r.transcript, transcriptStatus: 'done' })
    .where(eq(schema.callRecordings.id, rec.id));

  // Charged on success, and after the text is safely stored: if the debit fails
  // the client has their transcript and we are out a fraction of a penny, which
  // is the right way round.
  try {
    await debit({
      tenantId: s.tenantId, amountMinor: costMinor, reason: 'transcription',
      // Keyed on the recording, so a retry after a failed debit cannot charge
      // twice for the same transcript.
      reference: `tr_${rec.id}`, meta: { callid: rec.callid, seconds }
    });
  } catch (e: any) {
    console.error('[transcribe] stored but not charged:', e?.message);
  }

  return { ok: true, transcript: r.transcript, chargedMinor: costMinor, currency: wallet.currency };
});
