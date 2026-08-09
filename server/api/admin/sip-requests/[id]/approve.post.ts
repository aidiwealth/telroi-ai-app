// POST /api/admin/sip-requests/:id/approve -> trust this address.
//
// Writes a PJSIP endpoint identified by source address with no password. There
// is nothing to rotate afterwards: withdrawing access means removing the
// endpoint, which is why this is a decision rather than a toggle.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [reqRow] = await db.select().from(schema.sipIpRequests).where(eq(schema.sipIpRequests.id, id)).limit(1);
  if (!reqRow) throw apiError('not_found', 'Request not found', 404);
  if (reqRow.status !== 'pending') throw apiError('already_decided', `This request was already ${reqRow.status}.`, 409);

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, reqRow.tenantId)).limit(1);

  const cfg = useRuntimeConfig();
  const url = `${cfg.provisionAgentUrl}/provision-ip`;
  const res: any = await $fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.provisionAgentSecret}` },
    body: { tenantId: reqRow.tenantId, ipAddress: reqRow.ipAddress, label: `${tenant?.slug || 'client'}-ip` }
  }).catch((e: any) => { throw apiError('provision_failed', e?.data?.error || e?.message || 'Could not provision', 502); });

  if (!res?.ok) throw apiError('provision_failed', res?.error || 'Could not provision', 502);

  const [ep] = await db.insert(schema.sipEndpoints).values({
    tenantId: reqRow.tenantId, provider: 'telroi', kind: 'registration',
    externalId: res.username, label: `${tenant?.slug || 'client'}-ip`,
    sipUsername: res.username, domain: res.domain,
    meta: { ipAuth: true, ipAddress: reqRow.ipAddress }
  }).returning();

  await db.update(schema.sipIpRequests).set({
    status: 'approved', decidedBy: admin.email, decidedAt: new Date(), endpointId: ep.id
  }).where(eq(schema.sipIpRequests.id, id));

  await logEvent({
    tenantId: reqRow.tenantId, kind: 'system', action: 'sip.ip_approved',
    summary: `${admin.email} trusted ${reqRow.ipAddress} for SIP (${res.username})`
  });

  return { ok: true, username: res.username };
});
