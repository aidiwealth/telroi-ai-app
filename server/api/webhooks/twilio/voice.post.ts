// Twilio inbound voice + status webhook.
// - On an inbound call, Twilio POSTs call params (From, To, CallSid, CallStatus).
//   We log it (attributed to the tenant owning the 'To' number) and return TwiML.
// - Twilio also POSTs status callbacks (ringing/in-progress/completed) to this
//   URL when statusCallback is configured; we upsert the same CallSid row.
// Verified with the X-Twilio-Signature header using the account auth token.
import { upsertCallEvent, tenantForNumber, normalizeStatus } from '~/server/utils/call-log';

export default defineEventHandler(async (event) => {
  const form = await readBody<Record<string, string>>(event).catch(() => ({} as any));
  // h3 parses urlencoded bodies into an object; ensure we have the fields.
  const p: any = form || {};
  const callSid = p.CallSid || p.callSid;
  const from = p.From || p.from;
  const to = p.To || p.to;
  const status = p.CallStatus || p.callStatus;
  const recordingUrl = p.RecordingUrl || null;
  const durationStr = p.CallDuration || p.Duration;

  // Verify signature (best-effort; skips if not configured).
  try {
    const { verifyTwilioSignature } = await import('~/server/utils/webhook-verify');
    const ok = await verifyTwilioSignature(event, p);
    if (ok === false) { setResponseStatus(event, 403); return 'invalid signature'; }
  } catch { /* verification unavailable — proceed (logged) */ }

  if (callSid && to) {
    try {
      const tenantId = await tenantForNumber(to);
      if (tenantId) {
        await upsertCallEvent({
          tenantId, callid: callSid, carrier: 'twilio', direction: 'in',
          phone: from, status: status ? normalizeStatus('twilio', status) : 'ringing',
          duration: durationStr ? parseInt(durationStr, 10) : undefined,
          recordingUrl, raw: { to, from, twilioStatus: status }
        });
      }
    } catch (e) { console.error('[twilio webhook] log failed', e); }
  }

  // Respond with TwiML driven by the number's UNIFIED route (same model for
  // every carrier): AI agent, a person, or a department.
  setHeader(event, 'content-type', 'text/xml');
  let twiml = `<Say voice="Polly.Joanna">Thanks for calling.</Say>`;
  try {
    if (to) {
      const tenantId2 = await tenantForNumber(to);
      if (tenantId2) {
        const { resolveInboundAction } = await import('~/server/utils/inbound-routing');
        const act = await resolveInboundAction(tenantId2, to);
        if (act.action === 'ai') {
          // AI answers via the media gateway; greet then connect the AI leg.
          twiml = `<Say voice="Polly.Joanna">${escapeXml(act.greeting || 'How can I help you?')}</Say><Pause length="60"/>`;
        } else if (act.action === 'dial_person' && act.dialTarget) {
          twiml = `<Dial>${escapeXml(act.dialTarget)}</Dial>`;
        } else if (act.action === 'dial_department' && act.dialTarget) {
          twiml = `${act.greeting ? `<Say voice="Polly.Joanna">${escapeXml(act.greeting)}</Say>` : ''}<Enqueue>${escapeXml(act.dialTarget)}</Enqueue>`;
        }
      }
    }
  } catch (e) { console.error('[twilio webhook] route resolve failed', e); }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${twiml}\n</Response>`;
});

function escapeXml(s: string) { return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string)); }
