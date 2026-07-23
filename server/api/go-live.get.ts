// GET /api/go-live
// What the client needs to render their go-live state: whether they're live,
// where compliance stands, and how much sandbox allowance is left.
import { requireTenant } from '~/server/utils/api';
import { goLiveState } from '~/server/utils/go-live';
import { sandboxStatus } from '~/server/utils/sandbox-limits';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const [live, sandbox] = await Promise.all([
    goLiveState(s.tenantId),
    sandboxStatus(s.tenantId)
  ]);
  return { ...live, sandbox };
});
