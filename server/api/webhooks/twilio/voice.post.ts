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
  const digits = p.Digits || p.digits || '';
  const flowNode = p.flowNode || '';  // set via our Gather action= URL query

  // Verify signature (best-effort; skips if not configured).
  try {
    const { verifyTwilioSignature } = await import('~/server/utils/webhook-verify');
    const ok = await verifyTwilioSignature(event, p);
    if (ok === false) { setResponseStatus(event, 403); return 'invalid signature'; }
  } catch { /* verification unavailable — proceed (logged) */ }

  if (callSid && to) {
    try {
      const tenantId = await tenantForNumber(to);
      if (!tenantId) {
        // Number isn't assigned to a tenant, so the call can't be attributed or
        // logged (call_events requires a tenant). Warn so it's visible instead of
        // silently dropped — usual cause is a bought-but-unassigned number.
        console.warn(`[twilio webhook] inbound for unassigned number (to=${to} from=${from}) — not logged. Assign this number to a tenant to enable routing + call logs.`);
      }
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
        // If Twilio is posting back a pressed digit for an IVR menu, advance the
        // flow to the chosen option's node instead of re-resolving the entry.
        let act;
        if (flowNode && digits) {
          const { resolveFlowNode } = await import('~/server/utils/inbound-routing');
          const menu = await resolveFlowNode(tenantId2, to, flowNode);
          const chosen = menu.ivr?.options?.find((o: any) => o.digit === String(digits));
          act = chosen?.nextNodeId ? await resolveFlowNode(tenantId2, to, chosen.nextNodeId) : { action: 'reject' } as any;
        } else if (flowNode) {
          const { resolveFlowNode } = await import('~/server/utils/inbound-routing');
          act = await resolveFlowNode(tenantId2, to, flowNode);
        } else {
          act = await resolveInboundAction(tenantId2, to);
        }
        if (act.action === 'ai') {
          // Fork the call audio to our media adapter, which drives the same brain
          // the other carrier uses. The greeting comes from there in the agent's
          // own voice rather than being read here — this used to say hello and
          // then leave the caller in silence for a minute.
          const wsUrl = process.env.TWILIO_MEDIA_WS_URL || 'wss://sip.telroi.ai:8443/twilio-media';
          const param = (k: string, v: unknown) =>
            v === null || v === undefined || v === '' ? '' : `<Parameter name="${k}" value="${escapeXml(String(v))}"/>`;
          twiml = `<Connect><Stream url="${escapeXml(wsUrl)}">`
            + param('agentId', act.agentId)
            + param('tenantId', tenantId2)
            + param('telnum', to)
            + param('escalateTo', act.escalateTo)
            + param('escalateAfter', act.escalateAfter)
            + param('escalateMode', (act as any).escalateMode)
            + `</Stream></Connect>`;
        } else if (act.action === 'ring_all') {
          // The agents are registered to our PBX, which the carrier can't reach —
          // hand the call there and let it ring them, the same handoff the other
          // carrier uses. Answering on this side first would leave the caller
          // hearing silence while we set it up.
          const sipDomain = process.env.SIP_DOMAIN || 'sip.telroi.ai';
          twiml = `<Dial answerOnBridge="true"><Sip>sip:esc-${escapeXml(to)}@${escapeXml(sipDomain)}</Sip></Dial>`;
        } else if (act.action === 'dial_person' && act.dialTarget) {
          twiml = `<Dial>${escapeXml(act.dialTarget)}</Dial>`;
        } else if (act.action === 'dial_department' && act.dialTarget) {
          twiml = `${act.greeting ? `<Say voice="Polly.Joanna">${escapeXml(act.greeting)}</Say>` : ''}<Enqueue>${escapeXml(act.dialTarget)}</Enqueue>`;
        } else if (act.action === 'ivr' && act.ivr) {
          const base = `${useRuntimeConfig().public.appBaseUrl}/api/webhooks/twilio/voice`;
          if (act.ivr.kind === 'menu') {
            // Play the prompt inside a Gather; the digit re-posts with flowNode set to THIS menu.
            const menuNodeId = flowNode || act.ivr.nodeId || '';
            twiml = `<Gather numDigits="1" action="${escapeXml(base)}?flowNode=${encodeURIComponent(menuNodeId)}" method="POST"><Say voice="Polly.Joanna">${escapeXml(act.ivr.text)}</Say></Gather><Say voice="Polly.Joanna">We did not receive a selection. Goodbye.</Say><Hangup/>`;
          } else if (act.ivr.kind === 'say') {
            const next = act.ivr.nextNodeId ? `<Redirect method="POST">${escapeXml(base)}?flowNode=${encodeURIComponent(act.ivr.nextNodeId)}</Redirect>` : '';
            twiml = `<Say voice="Polly.Joanna">${escapeXml(act.ivr.text)}</Say>${next}`;
          } else if (act.ivr.kind === 'voicemail') {
            twiml = `<Say voice="Polly.Joanna">${escapeXml(act.ivr.text || 'Please leave a message after the tone.')}</Say><Record maxLength="120"/><Hangup/>`;
          }
        }
      }
    }
  } catch (e) { console.error('[twilio webhook] route resolve failed', e); }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${twiml}\n</Response>`;
});

function escapeXml(s: string) { return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string)); }
