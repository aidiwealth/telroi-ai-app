// GET /api/voice/capacity?tenantId=... -> { capacity, inUse, available, ok }
// Internal endpoint the control-app calls before connecting an inbound AI call,
// so inbound calls respect the tenant's paid concurrent-channel limit (the same
// unified count used by the dialer/widget/API paths). Auth: shared secret header
// (x-telroi-internal), identical to /api/voice/ai/turn.
import { channelUsage } from '~/server/utils/channel-limits';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const tenantId = getQuery(event).tenantId as string;
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenantId required' });
  const u = await channelUsage(tenantId);

  // Internal workspaces — our own support desk — aren't metered. The widget path
  // already skipped them, so a phone call was refused for being at capacity while
  // a web call to the same agents went through.
  const { useDb, schema } = await import('~/server/db');
  const { eq } = await import('drizzle-orm');
  const [t] = await useDb().select({ isInternal: schema.tenants.isInternal })
    .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (t?.isInternal) return { ...u, ok: true };

  return { ...u, ok: u.capacity === 0 ? false : u.inUse < u.capacity };
});
