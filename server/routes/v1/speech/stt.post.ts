// POST /v1/speech/stt { audio_url } -> transcribe speech to text.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';
const Body = z.object({ audio_url: z.string().url().optional(), audio_base64: z.string().optional(), language: z.string().optional() });
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'speech:write')) throw apiError('forbidden', 'Key lacks speech:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success || (!p.data.audio_url && !p.data.audio_base64)) throw apiError('invalid', 'audio_url or audio_base64 is required');

  if (ctx.env === 'sandbox') {
    return { object: 'transcription', simulated: true, livemode: false, id: `stt_test_${Math.random().toString(36).slice(2, 10)}`, status: 'done', transcript: 'This is a sandbox transcription.' };
  }

  const db = useDb();
  const [job] = await db.insert(schema.speechJobs).values({ tenantId: ctx.tenantId, kind: 'stt', status: 'processing' }).returning({ id: schema.speechJobs.id });
  const { transcribeSpeech } = await import('~/server/utils/voice/vendors');
  const r = await transcribeSpeech({ audioUrl: p.data.audio_url, audioBase64: p.data.audio_base64, language: p.data.language });
  if (!r.ok) {
    await db.update(schema.speechJobs).set({ status: 'failed', reason: r.reason }).where(eq(schema.speechJobs.id, job.id));
    throw apiError('speech_failed', r.reason || 'STT failed', 502);
  }
  await db.update(schema.speechJobs).set({ status: 'done', transcript: r.transcript, durationMs: r.durationMs, completedAt: new Date() }).where(eq(schema.speechJobs.id, job.id));
  return { object: 'transcription', livemode: true, id: job.id, status: 'done', transcript: r.transcript || '' };
});
