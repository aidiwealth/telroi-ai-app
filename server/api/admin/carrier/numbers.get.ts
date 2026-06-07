// GET /api/admin/carrier/numbers?provider=sotel|telroi|twilio|telnyx (optional)
// Returns provisioned numbers from inventory, optionally filtered by carrier.
// Used to populate caller-ID / number pickers in admin settings so numbers are
// SELECTED from provisioning, never typed.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const provider = (getQuery(event).provider as string) || '';
  const base = db.select({ telnum: schema.numberInventory.telnum, region: schema.numberInventory.region, provider: schema.numberInventory.provider, status: schema.numberInventory.status })
    .from(schema.numberInventory);
  const rows = provider
    ? await base.where(eq(schema.numberInventory.provider, provider))
    : await base;
  return { numbers: rows };
});
