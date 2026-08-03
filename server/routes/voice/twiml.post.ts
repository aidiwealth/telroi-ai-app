// POST /voice/twiml -> TwiML that Twilio fetches when a browser client places
// an outgoing call. It dials the requested destination from the configured
// caller id, bridging the browser leg to the PSTN/agent number.
import { voiceCredentials } from '~/server/utils/voice-credentials';
export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'text/xml');
  const body = await readBody(event).catch(() => ({}));
  const to = (body?.To || getQuery(event).To || '').toString();
  // Twilio forwards whatever the browser passed as CallerId, which is the number
  // the client chose to dial from and one the token already checked they own.
  // Reading a platform-wide value instead meant every client's calls would carry
  // our number — and that value was empty, so the Dial had no caller id at all
  // and Twilio refused the call outright.
  let callerId = (body?.CallerId || getQuery(event).CallerId || '').toString().trim();
  if (!callerId) {
    try { const { twilio } = await voiceCredentials(); callerId = twilio?.callerId || ''; } catch { callerId = ''; }
  }
  // Escape minimal XML.
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as any)[c]);
  if (!to) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>No destination provided.</Say></Response>`;
  }
  if (!callerId) {
    // Better to say so than to hand Twilio a Dial it will reject with a warning
    // nobody reads.
    console.error('[twiml] no caller id for outbound call to', to);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not set up to make calls yet. Please choose a number to call from.</Say></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${esc(callerId)}"><Number>${esc(to)}</Number></Dial></Response>`;
});
