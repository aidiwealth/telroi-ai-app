// GET /api/voice/sip/status -> tenant's SIP endpoints with LIVE registration state.
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { agentEndpointStatus } from '~/server/utils/provision-agent';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const rows = await useDb().select({
    id: schema.sipEndpoints.id,
    label: schema.sipEndpoints.label,
    sipUsername: schema.sipEndpoints.sipUsername,
    provider: schema.sipEndpoints.provider,
    kind: schema.sipEndpoints.kind
  }).from(schema.sipEndpoints).where(eq(schema.sipEndpoints.tenantId, s.tenantId));

  const local = rows.filter((r) => r.sipUsername && (r.provider === 'telroi' || r.kind === 'registration'));
  const statusMap = new Map(
    (await agentEndpointStatus(local.map((r) => r.sipUsername as string))).map((st) => [st.username, st])
  );

  const endpoints = rows.map((r) => {
    const st = r.sipUsername ? statusMap.get(r.sipUsername) : undefined;
    const isLocal = !!r.sipUsername && (r.provider === 'telroi' || r.kind === 'registration');
    return {
      id: r.id,
      label: r.label || r.sipUsername || 'SIP device',
      username: r.sipUsername,
      provider: r.provider,
      kind: r.kind,
      registrable: isLocal,
      registered: st?.registered ?? false,
      contacts: st?.contacts ?? 0,
      rttMs: st?.rttMs ?? null,
      via: st?.via ?? null
    };
  });
  return { endpoints };
});
