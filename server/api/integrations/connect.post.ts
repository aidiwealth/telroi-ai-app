// POST /api/integrations/connect
// Connect (or update) a CRM/automation integration. Accepts provider-specific
// credentials, the desired direction(s) (embed / import), and verifies the
// credentials with the provider before saving — so a bad token fails fast.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';
import { adapterFor, SUPPORTED_PROVIDERS } from '~/server/utils/integrations/providers';

const Body = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS),
  // Provider-specific credential fields (all optional; validated per provider).
  apiKey: z.string().optional(),          // hubspot token, pipedrive token
  domain: z.string().optional(),          // pipedrive company domain
  accessToken: z.string().optional(),     // zoho oauth token
  dc: z.string().optional(),              // zoho data center (com/eu/in/...)
  modeEmbed: z.boolean().optional(),
  modeImport: z.boolean().optional(),
  config: z.record(z.any()).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A provider is required');
  const db = useDb();
  const d = p.data;

  // Assemble the credential blob this provider expects.
  const creds: any = {};
  if (d.apiKey) creds.apiKey = d.apiKey;
  if (d.domain) creds.domain = d.domain;
  if (d.accessToken) creds.accessToken = d.accessToken;
  if (d.dc) creds.dc = d.dc;

  // Verify with the provider (Zapier is a no-op test).
  const adapter = adapterFor(d.provider);
  if (adapter && (d.provider !== 'zapier')) {
    try { await adapter.test(creds); }
    catch (e: any) { throw apiError('connect_failed', e?.message || 'Could not verify the credentials with the provider.', 400); }
  }

  const credentialsEnc = Object.keys(creds).length ? encrypt(JSON.stringify(creds)) : null;
  const [existing] = await db.select().from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, s.tenantId), eq(schema.integrations.provider, d.provider))).limit(1);

  if (existing) {
    await db.update(schema.integrations).set({
      status: 'connected',
      credentialsEnc: credentialsEnc ?? existing.credentialsEnc,
      config: d.config || existing.config,
      modeEmbed: d.modeEmbed ?? existing.modeEmbed,
      modeImport: d.modeImport ?? existing.modeImport,
      lastSyncError: null,
      connectedAt: new Date()
    }).where(eq(schema.integrations.id, existing.id));
  } else {
    await db.insert(schema.integrations).values({
      tenantId: s.tenantId, provider: d.provider, status: 'connected',
      credentialsEnc, config: d.config || {},
      modeEmbed: d.modeEmbed ?? true, modeImport: d.modeImport ?? false,
      connectedByUserId: s.userId
    });
  }

  const { logEvent } = await import('~/server/utils/logs');
  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'integration.connect', summary: `Connected ${d.provider}` });
  return { ok: true, provider: d.provider, status: 'connected' };
});
