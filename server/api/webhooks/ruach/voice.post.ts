// Ruach SIP trunk inbound voice webhook (Nigeria only). Ruach (sip.ruach.ng) or
// its peered gateway posts inbound call events here. Protected by a shared secret
// (X-Telroi-Ruach-Secret) configured in admin. Resolves the number's UNIFIED
// route and returns it so the call connects the same way as every other carrier
// (AI / person / department).
import { upsertCallEvent, tenantForNumber } from '~/server/utils/call-log';
import { verifyRuachSecret } from '~/server/utils/webhook-verify';

export default defineEventHandler(async (event) => {
  const ok = await verifyRuachSecret(event);
  if (ok === false) { setResponseStatus(event, 403); return { ok: false, reason: 'invalid secret' }; }
  if (ok === null) { setResponseStatus(event, 401); return { ok: false, reason: 'secret not configured' }; }

  const b = await readBody<any>(event).catch(() => ({}));
  const callId = b.uid || b.callid || b.call_id || b.id;
  const to = b.to || b.callee || b.dst || b.diversion;
  const from = b.from || b.caller || b.src;
  const status = b.status || b.disposition || 'ringing';
  const duration = b.duration ? parseInt(String(b.duration), 10) : undefined;

  if (callId && to) {
    const tenantId = await tenantForNumber(to);
    if (tenantId) {
      let routeAction: any = undefined;
      try {
        const { resolveInboundAction } = await import('~/server/utils/inbound-routing');
        routeAction = await resolveInboundAction(tenantId, to);
      } catch { /* */ }
      await upsertCallEvent({
        tenantId, callid: String(callId), carrier: 'ruach', direction: 'in',
        phone: from, status, duration, recordingUrl: b.record || b.recording || null,
        raw: { to, from, ruachStatus: b.status, route: routeAction }
      });
      if (routeAction) return { ok: true, route: routeAction };
    }
  }
  return { ok: true };
});
