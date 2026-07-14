// Telnyx Call Control webhook. Telnyx POSTs call lifecycle events:
//   call.initiated -> ringing, call.answered -> answered, call.hangup -> completed
// We attribute inbound calls to the tenant owning the destination number and
// upsert one row per call_control_id. Verified via the Telnyx-Signature header.
import { upsertCallEvent, tenantForNumber, normalizeStatus } from '~/server/utils/call-log';

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event).catch(() => ({}));
  const rawBody = (event as any)._telnyxRawBody;

  try {
    const { verifyTelnyxSignature } = await import('~/server/utils/webhook-verify');
    const ok = await verifyTelnyxSignature(event, rawBody);
    if (ok === false) { setResponseStatus(event, 403); return { ok: false, reason: 'invalid signature' }; }
  } catch { /* proceed */ }

  const data = body?.data;
  const eventType = data?.event_type as string;
  const payload = data?.payload || {};
  const callId = payload.call_control_id || payload.call_leg_id || payload.call_session_id;
  const direction = payload.direction === 'incoming' ? 'in' : 'out';
  const to = payload.to;
  const from = payload.from;

  // Temporary: see exactly what Telnyx sends around a transfer, since the AI leg
  // is staying at 'ringing' instead of completing.
  console.log(`[telnyx evt] ${eventType} callId=${String(callId).slice(0, 20)} to=${to} from=${from} dir=${payload.direction}`);
  if (callId && eventType) {
    try {
      // Attribute to whichever leg is one of OUR numbers. Telnyx flips the
      // per-event `direction` (call.initiated=incoming, but call.answered/hangup
      // often report outgoing), so keying off direction alone made later events
      // match the external caller (unassigned) and skip logging — leaving calls
      // stuck at 'ringing'. Resolve by trying `to` then `from`: our assigned
      // number wins whichever field it's in, so the whole lifecycle attributes
      // to the same tenant + row.
      // The escalation handoff leg (a transfer to sip:esc-...@our-pbx) is internal
      // plumbing: the customer's own AI call is already logged, and Asterisk owns
      // the agent side from here. Logging it too would show customers a bogus
      // "outbound call to sip:esc-..." row and leak how routing works — so drop
      // these events before they reach attribution or the state machine.
      if (/(^|[:@])esc-/i.test(String(to || '')) || /^sip:/i.test(String(to || ''))) {
        return { ok: true, received: eventType, skipped: 'escalation-leg' };
      }

      let tenantId = await tenantForNumber(to);
      let matchedOurNumber = to;
      if (!tenantId) { tenantId = await tenantForNumber(from); matchedOurNumber = from; }
      // Stable direction: inbound when OUR number is the destination (`to`). This
      // does NOT flip across events (unlike payload.direction), so the state
      // machine + phone attribution stay correct for the whole call lifecycle.
      const isInbound = matchedOurNumber === to;
      const custPhone = isInbound ? from : to;
      if (!tenantId) {
        // The number isn't assigned to any tenant, so we can't attribute or log
        // the call (call_events requires a tenant). Warn so this is visible
        // instead of silently dropped — the usual cause is a bought-but-unassigned
        // number. Assign it under Numbers to enable routing + logging.
        console.warn(`[telnyx webhook] ${eventType} for unassigned number (to=${to} from=${from}) — not logged. Assign this number to a tenant to enable routing + call logs.`);
      }
      if (tenantId) {
        // On an incoming call, resolve the UNIFIED route so the Call Control
        // issuer knows how to handle it (AI / person / department) — same model
        // as every other carrier.
        let routeAction: any = undefined;
        if (isInbound && eventType === 'call.initiated' && to) {
          try {
            const { resolveInboundAction } = await import('~/server/utils/inbound-routing');
            routeAction = await resolveInboundAction(tenantId, matchedOurNumber);
          } catch { /* */ }
        }
        await upsertCallEvent({
          tenantId, callid: callId, carrier: 'telnyx', direction: isInbound ? 'in' : 'out',
          phone: custPhone,
          status: normalizeStatus('telnyx', eventType),
          raw: { eventType, to, from, route: routeAction }
        });
        // NOTE: do NOT early-return here on routeAction — the call still needs to
        // be answered + driven by the state machine below. Returning early on
        // call.initiated left the call at 'ringing' forever (never answered).

        // ---- Call Control IVR state machine (issue commands back to Telnyx) ----
        if (isInbound && callId) {
          const cc = await import('~/server/utils/telnyx-cc');
          const { resolveInboundAction, resolveFlowNode } = await import('~/server/utils/inbound-routing');

          // Advance the flow given an InboundAction: speak/gather for IVR, transfer/answer for terminals.
          const drive = async (act: any) => {
            if (!act) { await cc.telnyxHangup(callId); return; }
            if (act.action === 'ivr' && act.ivr) {
              if (act.ivr.kind === 'say') { await cc.telnyxSpeak(callId, act.ivr.text || '', act.ivr.nextNodeId || null); return; }
              if (act.ivr.kind === 'menu') { await cc.telnyxGather(callId, act.ivr.text || 'Please choose an option.', act.ivr.nodeId || ''); return; }
              if (act.ivr.kind === 'voicemail') { await cc.telnyxSpeak(callId, act.ivr.text || 'Please leave a message.', null); return; }
            }
            if (act.action === 'dial_person' || act.action === 'dial_department') {
              if (act.dialTarget) { await cc.telnyxTransfer(callId, act.dialTarget); return; }
            }
            if (act.action === 'ai') {
              // AI over Telnyx runs through the media adapter on the control-app:
              // Telnyx forks the call audio to our WebSocket, which buffers the
              // caller's speech, drives the AI brain (/api/voice/ai/turn), and
              // streams the reply back. Kick off streaming; the adapter takes over
              // from here (greeting, turns, hangup).
              const streamUrl = process.env.TELNYX_MEDIA_WS_URL || 'wss://sip.telroi.ai:8443/telnyx-media';
              try {
                await cc.telnyxStreamingStart(callId, streamUrl, {
                  agentId: act.agentId, tenantId, telnum: matchedOurNumber,
                  // The adapter needs the escalation config to hand off to a human:
                  // without it, the AI says "connecting you" and nothing happens.
                  escalateTo: act.escalateTo || null, escalateAfter: act.escalateAfter || 0,
                  escalateMode: (act as any).escalateMode || null
                });
              } catch (e: any) {
                console.error('[telnyx] streaming_start failed:', e?.message || e);
                await cc.telnyxSpeak(callId, 'Sorry, we could not connect you right now.', null);
              }
              return;
            }
            await cc.telnyxHangup(callId);
          };

          if (eventType === 'call.initiated') { await cc.telnyxAnswer(callId); return { ok: true }; }
          if (eventType === 'call.answered') { await drive(routeAction || await resolveInboundAction(tenantId, matchedOurNumber)); return { ok: true }; }
          if (eventType === 'call.speak.ended') {
            const st = cc.decodeState(payload.client_state);
            if (st.n) { await drive(await resolveFlowNode(tenantId, matchedOurNumber, st.n)); } else { await cc.telnyxHangup(callId); }
            return { ok: true };
          }
          if (eventType === 'call.gather.ended') {
            const st = cc.decodeState(payload.client_state);
            const digit = payload.digits || '';
            if (st.n && digit) {
              const menu = await resolveFlowNode(tenantId, matchedOurNumber, st.n);
              const chosen = menu.ivr?.options?.find((o: any) => o.digit === String(digit));
              if (chosen?.nextNodeId) { await drive(await resolveFlowNode(tenantId, matchedOurNumber, chosen.nextNodeId)); }
              else { await cc.telnyxSpeak(callId, 'Sorry, that was not a valid option. Goodbye.', null); }
            } else { await cc.telnyxHangup(callId); }
            return { ok: true };
          }
        }
      }
    } catch (e) { console.error('[telnyx webhook] log failed', e); }
  }
  return { ok: true, received: eventType || 'unknown' };
});
