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

  // An OTP call we placed. Nothing below applies — there's no inbound number to
  // match and no tenant to resolve from one — so this answers and returns before
  // any of the routing logic runs. The code was never given to Telnyx: it's read
  // from our own row now that they've told us somebody picked up.
  // The code has been read; there's nothing else this call is for. Left alone it
  // sits open until the carrier times it out, and a minute of silence bills the
  // same as a minute of speech.
  if (eventType === 'call.speak.ended' && payload.client_state) {
    let st = '';
    try { st = Buffer.from(String(payload.client_state), 'base64').toString('utf8'); } catch { /* not ours */ }
    if (st.includes('otp-done')) {
      try {
        const cc = await import('~/server/utils/telnyx-cc');
        await cc.telnyxHangup(callId);
      } catch (e) {
        console.error('[telnyx-otp] could not hang up:', (e as Error)?.message);
      }
      return { ok: true, otp: 'hungup' };
    }
  }

  // Telnyx has finished writing a recording and given us somewhere to fetch it.
  // Collected here rather than left with them: their URLs expire, and a
  // recording that lives only on a carrier's storage is a recording you lose
  // when you change carrier.
  if (eventType === 'call.recording.saved') {
    const url = payload.recording_urls?.wav || payload.recording_urls?.mp3
      || payload.public_recording_urls?.wav || payload.public_recording_urls?.mp3;
    if (url && callId) {
      // Deliberately not awaited: Telnyx retries a webhook we are slow to
      // acknowledge, and fetching several megabytes is not something to do
      // inside the acknowledgement.
      void (async () => {
        try {
          const { useDb, schema } = await import('~/server/db');
          const { eq } = await import('drizzle-orm');
          const [ev] = await useDb().select().from(schema.callEvents)
            .where(eq(schema.callEvents.callid, callId)).limit(1);
          if (!ev?.tenantId) { console.warn(`[telnyx] recording for unknown call ${callId}`); return; }

          const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
          if (!res.ok) { console.error(`[telnyx] recording fetch failed: HTTP ${res.status}`); return; }
          const audio = Buffer.from(await res.arrayBuffer());

          const cfg = useRuntimeConfig() as any;
          const store = await $fetch<any>('/api/voice/recording/store', {
            method: 'POST',
            headers: { 'x-telroi-internal': (cfg.internalSecret || cfg.provisionAgentSecret) as string },
            body: {
              tenantId: ev.tenantId, callid: callId,
              telnum: ev.telnum || null, direction: ev.direction || null, phone: ev.phone || null,
              durationSeconds: payload.recording_ended_at && payload.recording_started_at
                ? Math.round((new Date(payload.recording_ended_at).getTime() - new Date(payload.recording_started_at).getTime()) / 1000)
                : null,
              carrier: 'telnyx',
              audioBase64: audio.toString('base64')
            }
          });
          console.log(`[telnyx] recording stored for ${callId}: ${store?.key || 'ok'}`);
        } catch (e: any) {
          console.error('[telnyx] recording store failed:', e?.message || e);
        }
      })();
    }
    return { ok: true };
  }

  if (eventType === 'call.answered' && payload.client_state) {
    let state = '';
    try { state = Buffer.from(String(payload.client_state), 'base64').toString('utf8'); } catch { /* not ours */ }
    if (state.startsWith('otp:')) {
      const otpId = state.slice(4);
      try {
        const { useDb, schema } = await import('~/server/db');
        const { eq } = await import('drizzle-orm');
        const db = useDb();
        const [row] = await db.select({ code: schema.voiceOtps.pendingCode })
          .from(schema.voiceOtps).where(eq(schema.voiceOtps.id, otpId)).limit(1);
        if (row?.code) {
          const cc = await import('~/server/utils/telnyx-cc');
          await cc.telnyxSpeakCode(callId, row.code, 2);
          // Cleared as soon as it's spoken: it has no further use here, and a
          // live code sitting in a column is a code that can leak.
          await db.update(schema.voiceOtps).set({ pendingCode: null })
            .where(eq(schema.voiceOtps.id, otpId));
        }
      } catch (e) {
        console.error('[telnyx-otp] could not speak the code:', (e as Error)?.message);
      }
      return { ok: true, otp: true };
    }
  }

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
        // A call we can't attribute never reaches the state machine, so it is
        // never answered and the caller waits in silence until they give up —
        // with nothing anywhere to say why. Record it.
        if (!isInbound && callId && eventType === 'call.initiated') {
          await logEvent({
            tenantId: tenantId || null, kind: 'system', action: 'telnyx.unrouted', level: 'warn',
            summary: `${from} -> ${to} not treated as inbound (matched ${matchedOurNumber || 'nothing'})`, ref: callId
          });
        }

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
            if (act.action === 'ring_all') {
              // The agents are registered to our PBX, which the carrier can't
              // reach — hand the call there and let it ring them. Same handoff an
              // AI call uses when the caller asks for a person.
              const sipDomain = process.env.SIP_DOMAIN || 'sip.telroi.ai';
              await cc.telnyxTransfer(callId, `sip:esc-${matchedOurNumber}@${sipDomain}`);
              return;
            }
            // Recording, where the number records. Started before anything is
            // said or streamed, so the greeting and the whole AI conversation
            // are in the file — a recording that begins after the interesting
            // part is worse than none.
            //
            // Telnyx records on their side and stops at hangup by itself; a
            // call.recording.saved webhook follows with a URL to collect.
            if ((act as any).recordCalls && callId) {
              try {
                await cc.telnyxRecordStart(callId);
                console.log(`[telnyx] recording ${callId}`);
              } catch (e: any) {
                // A lost recording is a lost file; a thrown error here would be
                // a lost call.
                console.error('[telnyx] record_start failed:', e?.message || e);
              }
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
                  escalateMode: (act as any).escalateMode || null,
                  // Asterisk plays the recording notice from its dialplan before
                  // any of this. Telnyx has none, so the greeting carries it —
                  // and the adapter has to be told, since by then it knows only
                  // what we sent it.
                  needsNotice: !!(act as any).recordCalls
                });
              } catch (e: any) {
                console.error('[telnyx] streaming_start failed:', e?.message || e);
                await cc.telnyxSpeak(callId, 'Sorry, we could not connect you right now.', null);
              }
              return;
            }
            await cc.telnyxHangup(callId);
          };

          if (eventType === 'call.initiated') {
            await logEvent({ tenantId, kind: 'system', action: 'telnyx.initiated', summary: `${from} -> ${to} (answering)`, ref: callId });
            try { await cc.telnyxAnswer(callId); }
            catch (e: any) {
              await logEvent({ tenantId, kind: 'system', action: 'telnyx.answer_failed', level: 'error', summary: e?.message || 'answer failed', ref: callId });
            }
            return { ok: true };
          }
          if (eventType === 'call.answered') {
            const act = routeAction || await resolveInboundAction(tenantId, matchedOurNumber);
            await logEvent({ tenantId, kind: 'system', action: 'telnyx.routed', summary: `${to} -> ${act?.action || 'none'}`, ref: callId });
            await drive(act);
            return { ok: true };
          }
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
