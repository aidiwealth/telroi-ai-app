// GET /api/voice/agents -> Telroi users (with status)
import { requireTenant } from '~/server/utils/api';
import { demoIfAsked } from '~/server/utils/demo';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
    // Framed by the guided tour: sample data rather than an empty table,
  // and never a database read. See server/utils/demo.ts.
  const demo = demoIfAsked(event, 'agents'); if (demo) return demo;
  const s = await requireTenant(event);
  const client = await telroiFor(s.tenantId);
  return await client.listUsers({ with: 'status', ...getQuery(event) });
});
