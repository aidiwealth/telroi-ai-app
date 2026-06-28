// POST /api/admin/carriers — create or update a carrier (superadmin).
// Stores the record (encrypting secrets) AND pushes the trunk config to the PBX.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';
import { agentCarrierUpsert } from '~/server/utils/provision-agent';

const Body = z.object({
  name: z.string().regex(/^[a-z0-9]{2,32}$/, 'lowercase a-z0-9, 2-32 chars'),
  displayName: z.string().min(1).max(64),
  prefix: z.string().regex(/^[0-9]{2,4}$/, '2-4 digits'),
  region: z.string().default('NG'),
  sipGateway: z.string().min(1),
  sipPort: z.number().int().min(1).max(65535).default(5060),
  transport: z.enum(['udp', 'tcp', 'tls']).default('udp'),
  sipDomain: z.string().optional().nullable(),
  authUser: z.string().optional().nullable(),
  authPass: z.string().optional().nullable(),   // plaintext in; encrypted at rest
  fromUser: z.string().optional().nullable(),
  callerId: z.string().optional().nullable(),
  codecs: z.array(z.string()).optional(),
  webhookSecret: z.string().optional().nullable(),
  enabled: z.boolean().default(true)
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const body = Body.parse(await readBody(event));
  const db = useDb();

  // Existing carrier (by name)?
  const [existing] = await db.select().from(schema.carriers).where(eq(schema.carriers.name, body.name)).limit(1);

  // Resolve auth password: new value if provided, else keep existing.
  const authPassEnc = body.authPass
    ? encrypt(body.authPass)
    : (existing?.authPassEnc ?? null);
  const webhookSecretEnc = body.webhookSecret
    ? encrypt(body.webhookSecret)
    : (existing?.webhookSecretEnc ?? null);
  // The plaintext pass to push to the PBX: new value, or decrypt existing if needed.
  let authPassPlain: string | undefined = body.authPass || undefined;
  if (!authPassPlain && existing?.authPassEnc && body.authUser) {
    try { const { decrypt } = await import('~/server/utils/crypto'); authPassPlain = decrypt(existing.authPassEnc); } catch { /* ignore */ }
  }

  // 1) Push trunk config to the PBX (only if enabled and not a CHANGEME scaffold).
  let pushed = false;
  const isScaffold = body.sipGateway.includes('CHANGEME');
  if (body.enabled && !isScaffold) {
    await agentCarrierUpsert({
      name: body.name, displayName: body.displayName, prefix: body.prefix,
      sipGateway: body.sipGateway, sipPort: body.sipPort, transport: body.transport,
      sipDomain: body.sipDomain || undefined, authUser: body.authUser || undefined,
      authPass: authPassPlain, fromUser: body.fromUser || undefined,
      callerId: body.callerId || undefined, codecs: body.codecs
    });
    pushed = true;
  }

  // 2) Upsert the DB record.
  const values = {
    name: body.name, displayName: body.displayName, prefix: body.prefix,
    region: body.region, sipGateway: body.sipGateway, sipPort: body.sipPort,
    transport: body.transport, sipDomain: body.sipDomain ?? null,
    authUser: body.authUser ?? null, authPassEnc, fromUser: body.fromUser ?? null,
    callerId: body.callerId ?? null, codecs: body.codecs ?? ['ulaw', 'alaw'],
    webhookSecretEnc, enabled: body.enabled,
    status: pushed ? 'live' : (isScaffold ? 'scaffold' : 'disabled'),
    pushedAt: pushed ? new Date() : (existing?.pushedAt ?? null),
    updatedAt: new Date()
  };

  if (existing) {
    await db.update(schema.carriers).set(values).where(eq(schema.carriers.id, existing.id));
  } else {
    await db.insert(schema.carriers).values(values);
  }
  return { ok: true, name: body.name, pushed };
});
