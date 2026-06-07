// GET /api/voice/media?type=greeting -> PBX media catalog for IVR/greeting pickers
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const type = (getQuery(event).type as string) || 'greeting';
  const client = await telroiFor(s.tenantId);
  try { return { items: await client.mediaCatalog(type) }; }
  catch { return { items: [] }; }
});
