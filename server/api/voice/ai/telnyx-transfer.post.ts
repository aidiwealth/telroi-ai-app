// server/api/voice/ai/telnyx-transfer.post.ts
// Hands a live Telnyx call off to a human, on behalf of the control-app's media
// adapter. The adapter can't do this itself: the Telnyx API key lives here (in
// encrypted platform settings), not on the PBX box, and we don't want a second
// copy of the credential in another env file.
// Auth: the same shared internal secret as /ai/turn and /ai/whisper-tts.
import { telnyxTransfer } from '~/server/utils/telnyx-cc';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const body = await readBody(event).catch(() => ({} as any));
  const callId = String(body?.callId || '').trim();
  const to = String(body?.to || '').trim();
  if (!callId || !to) throw createError({ statusCode: 400, statusMessage: 'callId and to required' });

  try {
    await telnyxTransfer(callId, to);
    return { ok: true };
  } catch (e: any) {
    console.error('[telnyx-transfer] failed:', e?.message || e);
    return { ok: false, error: e?.message || 'transfer failed' };
  }
});
