// GET /api/admin/sip/status -> ALL tenants' SIP endpoints with live registration
// state. Platform-admin only. Support tool for diagnosing client SIP issues.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { agentEndpointStatus } from '~/server/utils/provision-agent';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const rows = await db.select({
    id: schema.sipEndpoints.id,
    label: schema.sipEndpoints.label,
    sipUsername: schema.sipEndpoints.sipUsername,
    provider: schema.sipEndpoints.provider,
    kind: schema.sipEndpoints.kind,
    tenantId: schema.sipEndpoints.tenantId,
    tenantName: schema.tenants.name,
    tenantSlug: schema.tenants.slug
  }).from(schema.sipEndpoints)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.sipEndpoints.tenantId));

  const local = rows.filter((r) => r.sipUsername && (r.provider === 'telroi' || r.kind === 'registration'));
  const statusMap = new Map(
    (await agentEndpointStatus(local.map((r) => r.sipUsername as string))).map((st) => [st.username, st])
  );

  const endpoints = rows.map((r) => {
    const st = r.sipUsername ? statusMap.get(r.sipUsername) : undefined;
    const isLocal = !!r.sipUsername && (r.provider === 'telroi' || r.kind === 'registration');
    return {
      id: r.id, label: r.label || r.sipUsername || 'SIP device', username: r.sipUsername,
      provider: r.provider, kind: r.kind, tenantId: r.tenantId,
      tenantName: r.tenantName || r.tenantSlug || r.tenantId,
      registrable: isLocal, registered: st?.registered ?? false,
      contacts: st?.contacts ?? 0, rttMs: st?.rttMs ?? null, via: st?.via ?? null
    };
  });
  const registrable = endpoints.filter((e) => e.registrable);
  const summary = { total: registrable.length, online: registrable.filter((e) => e.registered).length, offline: registrable.filter((e) => !e.registered).length };
  return { endpoints, summary };
});
