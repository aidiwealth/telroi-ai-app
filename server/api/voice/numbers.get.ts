import { requireTenant } from '~/server/utils/api';
import { demoIfAsked } from '~/server/utils/demo';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  // The guided tour frames this page. Sample data rather than an empty
  // table, and never a database read — see server/utils/demo.ts.
  const demo = demoIfAsked(event, 'numbers'); if (demo) return demo;
  const client = await telroiFor(s.tenantId);
  return await client.listNumbers(getQuery(event));
});
