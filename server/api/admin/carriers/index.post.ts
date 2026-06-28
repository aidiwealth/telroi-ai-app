// POST /api/admin/carriers — create or update a carrier (superadmin).
// Stores the record (encrypting secrets) AND pushes the trunk config to the PBX.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt, decrypt } from '~/server/utils/crypto';
import { agentCarrierUpsert, provisionAgentConfigured } from '~/server/utils/provision-agent';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);

  const raw = await readBody(event) || {};

  // Manual validation (matches the codebase style; returns clean 400s).
  const name = String(raw.name || '').trim();
  const displayName = String(raw.displayName || '').trim();
  const prefix = String(raw.prefix || '').trim();
  const sipGateway = String(raw.sipGateway || '').trim();
  if (!/^[a-z0-9]{2,32}$/.test(name)) throw apiError('bad_request', 'Name must be lowercase a-z0-9, 2-32 chars', 400);
  if (!displayName) throw apiError('bad_request', 'Display name is required', 400);
  if (!/^[0-9]{2,4}$/.test(prefix)) throw apiError('bad_request', 'Prefix must be 2-4 digits', 400);
  if (!sipGateway) throw apiError('bad_request', 'SIP gateway is required', 400);

  const region = String(raw.region || 'NG').trim() || 'NG';
  const sipPort = Number.isFinite(raw.sipPort) ? Math.trunc(raw.sipPort) : 5060;
  const transport = ['udp', 'tcp', 'tls'].includes(raw.transport) ? raw.transport : 'udp';
  const sipDomain = raw.sipDomain ? String(raw.sipDomain).trim() : null;
  const authUser = raw.authUser ? String(raw.authUser).trim() : null;
  const authPass = raw.authPass ? String(raw.authPass) : null;
  const fromUser = raw.fromUser ? String(raw.fromUser).trim() : null;
  const callerId = raw.callerId ? String(raw.callerId).trim() : null;
  const webhookSecret = raw.webhookSecret ? String(raw.webhookSecret) : null;
  const codecs = Array.isArray(raw.codecs) && raw.codecs.length ? raw.codecs.map(String) : null;
  const enabled = raw.enabled !== false;

  const db = useDb();
  const [existing] = await db.select().from(schema.carriers).where(eq(schema.carriers.name, name)).limit(1);

  const authPassEnc = authPass ? encrypt(authPass) : (existing?.authPassEnc ?? null);
  const webhookSecretEnc = webhookSecret ? encrypt(webhookSecret) : (existing?.webhookSecretEnc ?? null);

  // Plaintext pass to push to the PBX (new value, or decrypt existing).
  let authPassPlain: string | undefined = authPass || undefined;
  if (!authPassPlain && existing?.authPassEnc && authUser) {
    try { authPassPlain = decrypt(existing.authPassEnc); } catch { /* ignore */ }
  }

  // 1) Push to PBX (only if enabled and not a CHANGEME scaffold).
  let pushed = false;
  const isScaffold = sipGateway.includes('CHANGEME');
  if (enabled && !isScaffold) {
    if (!provisionAgentConfigured()) {
      throw apiError('agent_unavailable', 'PBX provisioning agent is not configured on this environment.', 503);
    }
    try {
      await agentCarrierUpsert({
        name, displayName, prefix, sipGateway, sipPort, transport,
        sipDomain: sipDomain || undefined, authUser: authUser || undefined,
        authPass: authPassPlain, fromUser: fromUser || undefined,
        callerId: callerId || undefined, codecs: codecs || undefined
      });
      pushed = true;
    } catch (e: any) {
      throw apiError('pbx_push_failed', `Could not push to PBX: ${e?.message || 'unknown error'}`, 502);
    }
  }

  // 2) Upsert the DB record.
  const values: any = {
    name, displayName, prefix, region, sipGateway, sipPort, transport,
    sipDomain, authUser, authPassEnc, fromUser, callerId,
    codecs: codecs ?? ['ulaw', 'alaw'], webhookSecretEnc, enabled,
    status: pushed ? 'live' : (isScaffold ? 'scaffold' : 'disabled'),
    pushedAt: pushed ? new Date() : (existing?.pushedAt ?? null),
    updatedAt: new Date()
  };

  if (existing) {
    await db.update(schema.carriers).set(values).where(eq(schema.carriers.id, existing.id));
  } else {
    await db.insert(schema.carriers).values(values);
  }
  return { ok: true, name, pushed };
});
