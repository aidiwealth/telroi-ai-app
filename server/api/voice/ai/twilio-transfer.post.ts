// server/api/voice/ai/twilio-transfer.post.ts
// Hands a live Twilio call off to a human, on behalf of the control-app's media
// adapter. As with the other carrier, the credentials live here rather than on
// the PBX box, so the adapter asks rather than holding a second copy.
import { twilio } from '~/server/utils/providers';
import { masterCarrierCreds } from '~/server/utils/platform';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const body = await readBody(event).catch(() => ({} as any));
  const callSid = String(body?.callSid || '').trim();
  const to = String(body?.to || '').trim();
  if (!callSid || !to) throw createError({ statusCode: 400, statusMessage: 'callSid and to required' });

  try {
    // The WebRTC card carries an API key for browser tokens, not the account's
    // auth token — using it to move a live call got a 401 from Twilio. The master
    // credentials are what their REST API accepts, and what outbound calls
    // already authenticate with.
    const master = await masterCarrierCreds();
    const creds = master?.twilio;
    if (!creds?.accountSid || !creds?.authToken) return { ok: false, error: 'Twilio not configured' };

    // A SIP target reaches our own PBX, where the agents are; anything else is a
    // number Twilio can dial directly.
    const esc = (v: string) => v.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch] as string));
    const dial = to.startsWith('sip:')
      ? `<Dial answerOnBridge="true"><Sip>${esc(to)}</Sip></Dial>`
      : `<Dial>${esc(to)}</Dial>`;

    await twilio.redirectCall(creds as any, callSid, `<Response>${dial}</Response>`);
    return { ok: true };
  } catch (e: any) {
    console.error('[twilio-transfer] failed:', e?.message || e);
    return { ok: false, error: e?.message || 'transfer failed' };
  }
});
