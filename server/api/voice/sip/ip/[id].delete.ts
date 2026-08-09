// DELETE /api/voice/sip/ip/:id -> withdraw an address.
//
// Allowed whether or not it was approved. A client decommissioning a server
// shouldn't wait on us to stop trusting its address — and since there is no
// password here, removing the endpoint is the only way that happens.
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { revokeSipIpRequest } from '~/server/utils/sip';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can change SIP access.', 403);
  }
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [row] = await db.select().from(schema.sipIpRequests)
    .where(and(eq(schema.sipIpRequests.id, id), eq(schema.sipIpRequests.tenantId, s.tenantId))).limit(1);
  if (!row) throw apiError('not_found', 'Request not found', 404);

  await revokeSipIpRequest(row, s.email);
  return { ok: true };
});
