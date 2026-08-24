// POST /api/internal/charge-call
//
// Charge for a call the control app has already logged.
//
// The inbound path writes to call_events directly, and it does more than
// upsertCallEvent does — infers a duration from timestamps, preserves agent
// time, computes the ring-to-answer wait. Routing it through upsertCallEvent
// would lose those, so the log stays where it is and only the charge comes here.
//
// Which keeps billing in one codebase: this calls the same chargeCall the rest
// of the platform calls, rather than the control app growing its own.
import { z } from 'zod';
import { apiError } from '~/server/utils/api';
import { chargeCall } from '~/server/utils/call-billing';

const Body = z.object({
  tenantId: z.string().uuid(),
  callId: z.string().min(1),
  seconds: z.number().int().min(0),
  provider: z.string().optional(),
  direction: z.string().optional()
});

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  if (!secret || getHeader(event, 'x-telroi-internal') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'tenantId, callId and seconds are required');
  if (p.data.seconds <= 0) return { ok: true, skipped: 'no duration' };

  // Keyed on the call id inside chargeCall, so a repeated report — a status
  // update after the one that ended the call — charges once.
  const res = await chargeCall({
    tenantId: p.data.tenantId,
    callId: p.data.callId,
    seconds: p.data.seconds,
    provider: p.data.provider,
    source: p.data.direction === 'out' ? 'outbound' : 'inbound'
  });

  return { ok: true, result: res };
});
