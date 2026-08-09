// POST /api/voice/sip/ip { ipAddress, note? } -> ask us to trust an address.
//
// A request rather than an immediate change: an IP-authenticated endpoint has no
// password to revoke, so a mistyped octet would quietly let a stranger place
// calls billed to this workspace. An operator looks before it takes effect.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({
  ipAddress: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Enter a single IPv4 address'),
  note: z.string().max(300).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can request SIP access.', 403);
  }
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'A valid IPv4 address is required');

  const octets = p.data.ipAddress.split('.').map(Number);
  if (octets.some((o) => o > 255)) throw apiError('invalid', 'That is not a valid IPv4 address');

  const db = useDb();
  const existing = await db.select().from(schema.sipIpRequests)
    .where(and(eq(schema.sipIpRequests.tenantId, s.tenantId), eq(schema.sipIpRequests.ipAddress, p.data.ipAddress)));
  const live = existing.find((r) => r.status === 'pending' || r.status === 'approved');
  if (live) {
    throw apiError('exists', live.status === 'pending'
      ? 'That address is already waiting for approval.'
      : 'That address is already approved.', 409);
  }

  const [row] = await db.insert(schema.sipIpRequests).values({
    tenantId: s.tenantId, ipAddress: p.data.ipAddress,
    note: p.data.note || null, requestedBy: s.email
  }).returning();

  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.ip_requested',
    summary: `${s.email} asked us to trust ${p.data.ipAddress} for SIP` });

  // Nobody watches a request queue. Told in the channel instead.
  import('~/server/utils/slack').then(({ slackSipIpRequest }) =>
    slackSipIpRequest({ ipAddress: p.data.ipAddress, email: s.email, note: p.data.note || null, tenantId: s.tenantId })
  ).catch((e) => console.error('slack sip-ip notice failed', e));

  return { request: { id: row.id, ipAddress: row.ipAddress, status: row.status, createdAt: row.createdAt } };
});
