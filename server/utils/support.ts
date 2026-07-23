// server/utils/support.ts
// The "Telroi Support" workspace is a dedicated tenant the customer-support team
// calls clients FROM. It reuses all the normal tenant machinery (calling, AI
// agents, wallet, history) — support staff get exactly what clients get. All
// admins share this one workspace; its id lives in platformSettings.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { platformSettings } from './platform';
import { getOrCreateWallet } from './wallet';

export interface SupportWorkspace {
  tenantId: string;
  telnum: string | null;
  provisioned: boolean;
}

/** Ensure the shared support workspace exists; create + provision it on first use. */
export async function ensureSupportWorkspace(): Promise<SupportWorkspace> {
  const db = useDb();
  const settings = await platformSettings();

  // Already linked — return it.
  if (settings?.supportTenantId) {
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, settings.supportTenantId)).limit(1);
    if (t) {
      return { tenantId: t.id, telnum: settings.supportTelnum || null, provisioned: !!(t.telroiDomain && t.telroiApiKeyEnc) };
    }
  }

  // Not linked (or stale link). The support tenant may STILL exist by slug from
  // a prior run where the link didn't persist — find it before inserting, to
  // avoid a duplicate-slug crash. Self-heal the settings link if so.
  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'telroi-support')).limit(1);
  if (existing) {
    await db.update(schema.platformSettings).set({ supportTenantId: existing.id }).where(eq(schema.platformSettings.id, 'singleton'));
    await getOrCreateWallet(existing.id, 'USD');
    return { tenantId: existing.id, telnum: settings?.supportTelnum || null, provisioned: !!(existing.telroiDomain && existing.telroiApiKeyEnc) };
  }

  // Create the support tenant (a normal workspace, flagged by slug). Use
  // ON CONFLICT so a concurrent/duplicate insert can NEVER throw on the slug —
  // if the row already exists, the insert no-ops and we fetch it by slug.
  let tenant;
  const inserted = await db.insert(schema.tenants).values({
    name: 'Telroi Support',
    slug: 'telroi-support',
    plan: 'growth',          // support gets full Telroi One (AI, dialer, etc.)
    isInternal: true,        // not a customer — hidden from the client list
    onboardingStep: 5
  }).onConflictDoNothing({ target: schema.tenants.slug }).returning();
  if (inserted.length) {
    tenant = inserted[0];
  } else {
    // Row already existed (conflict) — fetch it by slug.
    const [t2] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'telroi-support')).limit(1);
    if (!t2) throw new Error('support workspace insert conflicted but row not found');
    tenant = t2;
  }

  await getOrCreateWallet(tenant.id, 'USD');

  // Link it on the singleton settings row.
  await db.update(schema.platformSettings)
    .set({ supportTenantId: tenant.id })
    .where(eq(schema.platformSettings.id, 'singleton'));

  // Mark it ready so support can place calls immediately. There is no external
  // account to create — every workspace runs on our own PBX behind the master
  // carrier accounts — so this is just the state flag.
  await db.update(schema.tenants)
    .set({ provisionState: 'provisioned', wentLiveAt: tenant.wentLiveAt || new Date() })
    .where(eq(schema.tenants.id, tenant.id));

  const [fresh] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id)).limit(1);
  return { tenantId: tenant.id, telnum: settings?.supportTelnum || null, provisioned: fresh?.provisionState === 'provisioned' };
}
