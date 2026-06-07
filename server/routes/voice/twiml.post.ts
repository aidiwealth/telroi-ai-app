// POST /voice/twiml -> TwiML that Twilio fetches when a browser client places
// an outgoing call. It dials the requested destination from the configured
// caller id, bridging the browser leg to the PSTN/agent number.
import { voiceCredentials } from '~/server/utils/voice-credentials';
export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'text/xml');
  const body = await readBody(event).catch(() => ({}));
  const to = (body?.To || getQuery(event).To || '').toString();
  let callerId = '';
  try { const { twilio } = await voiceCredentials(); callerId = twilio?.callerId || ''; } catch { callerId = ''; }
  // Escape minimal XML.
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as any)[c]);
  if (!to) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>No destination provided.</Say></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${esc(callerId)}"><Number>${esc(to)}</Number></Dial></Response>`;
});
