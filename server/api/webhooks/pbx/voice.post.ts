// PBX inbound voice webhook (Digidite / Telroi PBX). The PBX posts call events
// here if it supports outbound HTTP notifications. Protected by a shared secret
// (X-Telroi-Pbx-Secret) configured in admin. Field names vary by PBX build, so
// we read common aliases.
import { upsertCallEvent, tenantForNumber } from '~/server/utils/call-log';

export default defineEventHandler(async (event) => {
  const { verifyPbxSecret } = await import('~/server/utils/webhook-verify');
  const ok = await verifyPbxSecret(event);
  if (ok === false) { setResponseStatus(event, 403); return { ok: false, reason: 'invalid secret' }; }
  if (ok === null) { setResponseStatus(event, 401); return { ok: false, reason: 'secret not configured' }; }

  const b = await readBody<any>(event).catch(() => ({}));
  const callId = b.uid || b.callid || b.call_id || b.id;
  const to = b.to || b.callee || b.dst || b.diversion;
  const from = b.from || b.caller || b.src || b.client;
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
        tenantId, callid: String(callId), carrier: 'telroi', direction: 'in',
        phone: from, status, duration, recordingUrl: b.record || b.recording || null,
        raw: { to, from, pbxStatus: b.status, route: routeAction }
      });
      // Hand the PBX the resolved route so its dialplan connects the call the
      // same way as every other carrier (AI / person / department).
      if (routeAction) return { ok: true, route: routeAction };
    }
  }
  return { ok: true };
});
