// POST /api/admin/clients -> operator creates a client workspace.
//
// Aligned with the self-signup outcome and the platform's local-first model:
//  - Collects the business-level inputs that matter (name, subdomain, country,
//    optional sector / business phone / starting plan) — country drives wallet
//    currency and call-routing region.
//  - Creates the tenant LOCAL-FIRST (no eager carrier provisioning). The
//    workspace is immediately usable; carrier provisioning happens at go-live
//    (same as signup) — OR, if the operator ticks "provision now", we attempt it
//    as an explicit, non-blocking opt-in.
//  - Creates the wallet in the correct currency, anchors the plan trial, and
//    mirrors the client into the support CRM — so the new client is consistent
//    with billing, routing and the client-facing country setting from creation.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { currencyForCountry } from '~/server/utils/countries';
import { randomToken } from '~/server/utils/crypto';

const Body = z.object({
  client: z.string().min(1),
  subdomain: z.string().regex(/^[a-z0-9-]{2,40}$/),
  country: z.string().min(2).max(60),
  sector: z.string().max(60).optional(),
  businessPhone: z.string().max(32).optional(),
  plan: z.enum(['startup', 'growth']).default('startup'),
  language: z.string().default('en-US'),
  accountsLimit: z.number().int().min(1).default(10),
  maxLines: z.number().int().min(1).default(5),
  provisionNow: z.boolean().default(false)
});

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Client name, subdomain and country are required');
  const db = useDb();

  const existing = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, p.data.subdomain)).limit(1);
  if (existing.length) throw apiError('slug_taken', 'That subdomain is already taken');

  const [settings] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  const suffix = settings?.clientDomainSuffix || 'digitaltide.io';
  const fullDomain = `${p.data.subdomain}.${suffix}`;

  const trialDays = 7;
  const trialEndsAt = new Date(Date.now() + trialDays * 86400000);

  const [tenant] = await db.insert(schema.tenants).values({
    name: p.data.client,
    slug: p.data.subdomain,
    telroiDomain: fullDomain,
    country: p.data.country,
    sector: p.data.sector || null,
    businessPhone: p.data.businessPhone || null,
    plan: 'startup',
    trialPlan: p.data.plan,
    trialEndsAt,
    trialDays,
    planSelected: true,
    planNextBillingAt: trialEndsAt,
    onboardingStep: 1,
    unsubToken: randomToken(18)
  }).returning();

  let walletCurrency: 'NGN' | 'USD' = currencyForCountry(p.data.country);
  try {
    const { getOrCreateWallet } = await import('~/server/utils/wallet');
    const w = await getOrCreateWallet(tenant.id);
    walletCurrency = w.currency as 'NGN' | 'USD';
  } catch (e) { console.error('[admin create] wallet init failed', e); }

  if (p.data.businessPhone) {
    import('~/server/utils/support').then(async ({ ensureSupportWorkspace }) => {
      const ws = await ensureSupportWorkspace();
      const { upsertContactByPhone } = await import('~/server/utils/crm');
      await upsertContactByPhone(ws.tenantId, p.data.businessPhone!, {
        name: tenant.name, company: tenant.name,
        country: p.data.country, status: 'customer', source: 'Operator'
      });
    }).catch((e) => console.error('[admin create] support CRM mirror failed', e));
  }

  let provisioned = false;
  let provisionError: string | null = null;
  if (p.data.provisionNow) {
    try {
      const { OperatorClient, resolveDomainDefaults } = await import('~/server/utils/telroi/operator');
      const op = await OperatorClient.fromPlatform();
      const defaults = await resolveDomainDefaults(op, settings);
      try {
        await op.createDomain(fullDomain, {
          name: fullDomain, accessURL: `https://${fullDomain}`,
          client: p.data.client, language: p.data.language,
          accountsLimit: p.data.accountsLimit, maxLines: p.data.maxLines, billingType: 'demo',
          ...defaults
        });
      } catch (e: any) {
        const msg = e?.data?.error?.message || e?.message || '';
        const exists = e?.statusCode === 409 || /exist/i.test(typeof msg === 'string' ? msg : JSON.stringify(msg));
        if (!exists) throw e;
      }
      await db.update(schema.tenants)
        .set({ telroiApiKeyEnc: settings?.operatorApiKeyEnc ?? null, provisionState: 'provisioned', wentLiveAt: new Date() })
        .where(eq(schema.tenants.id, tenant.id));
      provisioned = true;
    } catch (e: any) {
      const m = e?.data?.error?.message || e?.message || String(e);
      provisionError = typeof m === 'string' ? m : JSON.stringify(m);
      console.error('[admin create] eager provisioning failed (client still created locally)', e);
    }
  }

  return { ok: true, domain: fullDomain, tenantId: tenant.id, country: p.data.country, walletCurrency, plan: p.data.plan, provisioned, provisionError };
});
