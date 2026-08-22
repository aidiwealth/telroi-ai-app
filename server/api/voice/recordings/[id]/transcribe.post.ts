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
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { hasFeature } from '~/server/utils/entitlements';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';
import { transcribeAudioBuffer } from '~/server/utils/voice/vendors';
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

  const seconds = rec.durationSeconds || 0;
  if (seconds < 1) throw apiError('too_short', 'That recording is too short to transcribe.', 400);

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

  const r = await transcribeAudioBuffer(audio.body, audio.contentType || 'audio/wav');
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
