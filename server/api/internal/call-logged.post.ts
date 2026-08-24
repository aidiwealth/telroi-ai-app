// POST /api/internal/call-logged
//
// The control app reporting a call it logged from the dialplan.
//
// It used to write straight into call_events, which meant the charge never ran:
// maybeChargeCall lives inside upsertCallEvent, and a direct insert goes around
// it. Every voice_minute entry in the ledger came from a carrier webhook, and
// not one call placed through the dialplan had ever been billed.
//
// So there is one path for reporting a call, and billing sits on it once.
import { apiError } from '~/server/utils/api';
import { upsertCallEvent } from '~/server/utils/call-log';

export default defineEventHandler(async (event) => {
  // The same shared secret every internal endpoint uses. There is no helper for
  // this; telnyx-trunk checks it inline and so does this.
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  if (!secret || getHeader(event, 'x-telroi-internal') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const b = await readBody<any>(event).catch(() => ({}));
  if (!b?.tenantId || !b?.callid) throw apiError('invalid', 'tenantId and callid are required');

  await upsertCallEvent({
    tenantId: b.tenantId,
    callid: b.callid,
    carrier: b.carrier || null,
    direction: b.direction || 'out',
    phone: b.phone || null,
    status: b.status,
    duration: typeof b.duration === 'number' ? b.duration : undefined,
    startedAt: b.startedAt ? new Date(b.startedAt) : undefined,
    user: b.user || null,
    raw: b.raw || {}
  });

  return { ok: true };
});
