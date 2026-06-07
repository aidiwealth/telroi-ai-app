// POST /v1/speech/tts { text, voice?, format? } -> synthesize speech.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({ text: z.string().min(1).max(5000), voice: z.string().optional(), format: z.enum(['mp3', 'wav', 'ogg']).optional(), language: z.string().optional() });
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'speech:write')) throw apiError('forbidden', 'Key lacks speech:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'text is required (max 5000 chars)');

  if (ctx.env === 'sandbox') {
    return { object: 'speech', simulated: true, livemode: false, id: `tts_test_${Math.random().toString(36).slice(2, 10)}`, status: 'done', format: p.data.format || 'mp3', url: 'https://sandbox.telroi.ai/speech/sample.mp3' };
  }

  const db = useDb();
  const { eq } = await import('drizzle-orm');
  const [job] = await db.insert(schema.speechJobs).values({ tenantId: ctx.tenantId, kind: 'tts', status: 'processing', voice: p.data.voice, format: p.data.format || 'mp3', inputChars: p.data.text.length }).returning({ id: schema.speechJobs.id });
  const { synthesizeSpeech } = await import('~/server/utils/voice/vendors');
  const r = await synthesizeSpeech({ text: p.data.text, voice: p.data.voice, format: p.data.format, language: p.data.language });
  if (!r.ok) {
    await db.update(schema.speechJobs).set({ status: 'failed', reason: r.reason }).where(eq(schema.speechJobs.id, job.id));
    throw apiError('speech_failed', r.reason || 'TTS failed', 502);
  }
  await db.update(schema.speechJobs).set({ status: 'done', resultUrl: r.resultUrl, durationMs: r.durationMs, completedAt: new Date() }).where(eq(schema.speechJobs.id, job.id));
  return { object: 'speech', livemode: true, id: job.id, status: 'done', format: p.data.format || 'mp3', url: r.resultUrl || null };
});
