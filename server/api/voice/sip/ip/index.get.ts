// GET /api/voice/sip/ip -> this workspace's IP-auth requests, and the details
// they need to configure their own side.
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { platformSettings } from '~/server/utils/platform';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.sipIpRequests)
    .where(eq(schema.sipIpRequests.tenantId, s.tenantId))
    .orderBy(desc(schema.sipIpRequests.createdAt));

  const ps: any = await platformSettings().catch(() => null);

  return {
    requests: rows.map((r) => ({
      id: r.id, ipAddress: r.ipAddress, note: r.note, status: r.status,
      rejectReason: r.rejectReason, createdAt: r.createdAt, decidedAt: r.decidedAt
    })),
    // Half of an interconnect is what they permit on their side. Leaving them to
    // find it in an email is how a setup stalls for a day over a port number.
    ours: {
      host: ps?.sipPublicHost || 'sip.telroi.ai',
      ip: ps?.sipPublicIp || '159.65.86.193',
      port: 5060,
      transport: 'UDP',
      rtpRange: '10000-20000',
      format: 'E.164 without the leading plus, e.g. 2348012345678',
      codecs: 'G.711 u-law, G.711 A-law'
    }
  };
});
