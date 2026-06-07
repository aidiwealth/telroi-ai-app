// POST /api/voice/call -> click-to-call. Routes to the carrier the FROM number
// is provisioned on (Telroi PBX / Twilio / Telnyx), passing the number through.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';

const Body = z.object({
  phone: z.string().min(3),          // destination
  from: z.string().optional(),       // which owned number to call from
  user: z.string().optional(),
  group: z.string().optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'A phone number is required');

  const { useDb, schema } = await import('~/server/db');
  const db = useDb();
  const attemptRef = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Records the outcome of this attempt into our own call log so EVERY attempt —
  // including failures and non-PBX (Twilio/Telnyx) calls — is visible, not just
  // what the PBX history returns.
  async function logAttempt(status: string, extra: Record<string, unknown> = {}) {
    try {
      await db.insert(schema.callEvents).values({
        tenantId: s.tenantId, callid: attemptRef, type: 'out', direction: 'out',
        phone: parsed.data!.phone, user: parsed.data!.user || null,
        status, startedAt: new Date(), duration: 0, wait: 0,
        raw: { from: parsed.data!.from || null, ...extra }
      });
    } catch { /* logging must never block the call */ }
  }

  // Hard stop at zero: don't originate a call a wallet can't pay for.
  const { canAfford } = await import('~/server/utils/wallet');
  if (!(await canAfford(s.tenantId, 1))) {
    await logAttempt('failed', { reason: 'insufficient_funds' });
    throw apiError('insufficient_funds', 'Wallet balance is empty. Please top up to place calls.', 402);
  }

  // Role/department permission: the user must be allowed to make calls, and (if a
  // FROM number is given) it must belong to a team they're in. Owners/admins pass.
  const { canCallFromNumber, getCallCaps } = await import('~/server/utils/permissions');
  if (parsed.data.from) {
    const perm = await canCallFromNumber(s.tenantId, s.userId, parsed.data.from);
    if (!perm.ok) {
      await logAttempt('failed', { reason: 'forbidden' });
      throw apiError('forbidden', perm.reason || 'Not permitted to call from this number.', 403);
    }
  } else {
    const caps = await getCallCaps(s.tenantId, s.userId);
    if (!caps.makeCalls) {
      await logAttempt('failed', { reason: 'forbidden' });
      throw apiError('forbidden', 'You do not have permission to make calls.', 403);
    }
  }

  // Lazy provisioning: if the tenant is LIVE and the from-number is still local,
  // provision it on the country's vendor now (and begin billing it). In sandbox/
  // local this is skipped, so local usage stays free.
  if (parsed.data.from) {
    try {
      const { and, eq } = await import('drizzle-orm');
      const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
      const isLive = tenant && !tenant.sandboxMode && tenant.provisionState !== 'local';
      if (isLive) {
        const [sub] = await db.select().from(schema.numberSubscriptions)
          .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId), eq(schema.numberSubscriptions.telnum, parsed.data.from))).limit(1);
        if (sub && sub.provisionState !== 'provisioned') {
          const { ensureNumberProvisioned } = await import('~/server/utils/provision-lifecycle');
          await ensureNumberProvisioned(s.tenantId, sub.id);
        }
      }
    } catch { /* provisioning best-effort; call still attempts */ }
  }

  try {
    // Carrier-agnostic block list — refuse blocked destinations on any carrier.
    const { assertNotBlacklisted } = await import('~/server/utils/blacklist');
    try { await assertNotBlacklisted(s.tenantId, parsed.data.phone); }
    catch (be: any) { await logAttempt('failed', { reason: 'blacklisted' }); throw be; }
    // Enforce the tenant's paid channel capacity (simultaneous-call limit).
    // Sandbox is exempt so testing isn't blocked.
    const { isSandbox } = await import('~/server/utils/sandbox');
    if (!(await isSandbox(s.tenantId))) {
      const { assertChannelAvailable } = await import('~/server/utils/channel-limits');
      try { await assertChannelAvailable(s.tenantId); }
      catch (ce: any) { await logAttempt('failed', { reason: ce?.data?.error?.code || 'channels' }); throw ce; }
    }
    let result: any;
    if (parsed.data.from) {
      result = await placeCall({
        tenantId: s.tenantId, fromTelnum: parsed.data.from,
        to: parsed.data.phone, user: parsed.data.user, group: parsed.data.group
      });
    } else {
      const client = await telroiFor(s.tenantId);
      result = await client.makeCall({ phone: parsed.data.phone, user: parsed.data.user, group: parsed.data.group });
    }
    await logAttempt('placed', { callid: result?.callid || result?.call_id || null });
    return result;
  } catch (e: any) {
    await logAttempt('failed', { reason: e?.data?.error?.code || e?.message || 'error' });
    throw e;
  }
});
