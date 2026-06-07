import { eq, or, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const vans = await db.select().from(schema.vans).where(eq(schema.vans.tenantId, ws.tenantId));
  const agents = await db.select({ id: schema.aiAgents.id, name: schema.aiAgents.name }).from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, ws.tenantId));

  // Numbers the support workspace can bind a VAN to:
  //  1. Numbers already subscribed to the support workspace.
  //  2. Numbers provisioned in inventory on Telroi's own carriers (Digidite/Sotel
  //     for NG, Twilio/Telnyx for international) that aren't sold to a client —
  //     so admin can build NG *and* international support VANs from one place.
  const subs = await db.select().from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, ws.tenantId));
  const inv = await db.select({ telnum: schema.numberInventory.telnum, region: schema.numberInventory.region, provider: schema.numberInventory.provider, status: schema.numberInventory.status, soldToTenantId: schema.numberInventory.soldToTenantId })
    .from(schema.numberInventory);

  const seen = new Set<string>();
  const numbers: any[] = [];
  for (const s of subs) { if (!seen.has(s.telnum)) { seen.add(s.telnum); numbers.push({ telnum: s.telnum, region: s.region, provider: s.provider, source: 'subscription', status: 'active' }); } }
  for (const i of inv) {
    // Available (not sold to a client) or already sold to the support workspace.
    const assignable = i.status !== 'sold' || i.soldToTenantId === ws.tenantId;
    if (assignable && !seen.has(i.telnum)) { seen.add(i.telnum); numbers.push({ telnum: i.telnum, region: i.region, provider: i.provider, source: 'inventory', status: 'active' }); }
  }
  return { vans, agents, numbers };
});
