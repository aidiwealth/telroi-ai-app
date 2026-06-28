// GET /api/admin/carriers — list all platform carriers (superadmin).
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const rows = await db.select().from(schema.carriers).orderBy(schema.carriers.prefix);
  // Never return secrets; just flag whether they're set.
  return rows.map((c: any) => ({
    id: c.id, name: c.name, displayName: c.displayName, prefix: c.prefix,
    region: c.region, sipGateway: c.sipGateway, sipPort: c.sipPort,
    transport: c.transport, sipDomain: c.sipDomain, authUser: c.authUser,
    fromUser: c.fromUser, callerId: c.callerId, codecs: c.codecs,
    enabled: c.enabled, status: c.status, pushedAt: c.pushedAt,
    authPassSet: !!c.authPassEnc, webhookSecretSet: !!c.webhookSecretEnc
  }));
});
