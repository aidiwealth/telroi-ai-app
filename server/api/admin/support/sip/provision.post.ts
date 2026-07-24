// POST /api/admin/support/sip/provision
// Give the signed-in admin a SIP endpoint on the support workspace so support
// calls can ring them.
//
// One endpoint per admin rather than a shared one: ring_all can then reach
// everybody who is online, and a call can be attributed to whoever answered.
// Re-calling this is safe — an admin who already has an endpoint keeps it.
import { eq, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { agentProvision, provisionAgentConfigured } from '~/server/utils/provision-agent';
import { encrypt, decrypt } from '~/server/utils/crypto';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const db = useDb();
  const ws = await ensureSupportWorkspace();

  // Stable per-admin label so re-provisioning finds the existing endpoint.
  const who = String((admin as any).id || admin.email || 'agent').replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
  const label = `support-${who}`;

  const [existing] = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, ws.tenantId), eq(schema.sipEndpoints.label, label)))
    .limit(1);

  if (existing) {
    let password: string | null = null;
    try { if (existing.secretEnc) password = decrypt(existing.secretEnc); } catch { /* not recoverable */ }
    return {
      ok: true, created: false,
      sipUsername: existing.sipUsername, password,
      domain: existing.domain, label
    };
  }

  if (!provisionAgentConfigured()) {
    throw apiError('not_configured', 'The PBX provisioning agent is not configured, so support endpoints cannot be created.', 503);
  }

  const result = await agentProvision(ws.tenantId, label, true); // webrtc
  const [row] = await db.insert(schema.sipEndpoints).values({
    tenantId: ws.tenantId, provider: 'telroi', kind: 'registration',
    externalId: result.username, label, sipUsername: result.username,
    secretEnc: encrypt(result.password),
    domain: result.domain, meta: { transport: result.transport, context: result.context, support: true }
  }).returning();

  return {
    ok: true, created: true,
    sipUsername: row.sipUsername, password: result.password,
    domain: row.domain, label
  };
});
