// DELETE /api/admin/sip-requests/:id -> withdraw trust in an address.
//
// The same path a client can take for their own. Ours exists because a client
// who has lost control of a server may not be the one who tells us — and with
// no password involved, removing the endpoint is the only way to stop trusting
// the address.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { revokeSipIpRequest } from '~/server/utils/sip';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [row] = await db.select().from(schema.sipIpRequests).where(eq(schema.sipIpRequests.id, id)).limit(1);
  if (!row) throw apiError('not_found', 'Request not found', 404);

  await revokeSipIpRequest(row, admin.email);
  return { ok: true };
});
