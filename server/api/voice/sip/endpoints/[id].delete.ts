// DELETE /api/voice/sip/endpoints/:id -> de-provision a SIP endpoint, removing
// the real vendor resource then the local record. Owner/admin only.
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { masterCarrierCreds } from '~/server/utils/platform';
import { twilio, telnyx } from '~/server/utils/providers';
import { telroiFor } from '~/server/utils/tenant';
import { agentDeprovision, provisionAgentConfigured } from '~/server/utils/provision-agent';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can remove SIP endpoints.', 403);
  }
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [ep] = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.id, id), eq(schema.sipEndpoints.tenantId, s.tenantId))).limit(1);
  if (!ep) throw apiError('not_found', 'SIP endpoint not found', 404);

  const creds = await masterCarrierCreds().catch(() => null);
  try {
    if (ep.provider === 'twilio' && creds?.twilio && ep.externalId) await twilio.deleteSipTrunk(creds.twilio, ep.externalId);
    else if (ep.provider === 'telnyx' && creds?.telnyx && ep.externalId) await telnyx.deleteConnection(creds.telnyx, ep.externalId);
    else if (ep.provider === 'telroi' && ep.externalId) {
      if (/^tnt_[a-f0-9]{8}$/.test(ep.externalId) && provisionAgentConfigured()) {
        await agentDeprovision(ep.externalId);
      } else {
        const client = await telroiFor(s.tenantId);
        await client.deleteSipRegistration(ep.externalId);
      }
    }
  } catch (e: any) {
    // Surface vendor failure but still allow removing the local record if vendor
    // resource is already gone (404 handled inside provider methods).
    throw apiError('vendor_error', e?.message || 'Could not remove the vendor resource', 502);
  }

  await db.delete(schema.sipEndpoints).where(eq(schema.sipEndpoints.id, id));
  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.deprovision', summary: `Removed ${ep.provider} SIP endpoint` });
  return { ok: true };
});
