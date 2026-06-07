// GET /api/admin/clients/:domain -> full workspace profile from the Telroi DB
// (wallet, numbers, VANs, AI, team), plus live Digitide info if reachable.
// Resolves by telroiDomain OR by synthetic slug.telroi.ai for unprovisioned ones.
import { eq, or } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { OperatorClient } from '~/server/utils/telroi/operator';
import { TelroiClient } from '~/server/utils/telroi/client';
import { useDb, schema } from '~/server/db';
import { apiError } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const domain = decodeURIComponent(getRouterParam(event, 'domain')!);
  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const db = useDb();

  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  if (!tenant) throw apiError('not_found', 'Workspace not found', 404);

  const tid = tenant.id;
  const [wallet, vans, flows, ai, subs, members, compliance, paymentMethod] = await Promise.all([
    db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tid)).then((r) => r[0] || null),
    db.select().from(schema.vans).where(eq(schema.vans.tenantId, tid)),
    db.select().from(schema.connectFlows).where(eq(schema.connectFlows.tenantId, tid)),
    db.select().from(schema.aiConnections).where(eq(schema.aiConnections.tenantId, tid)),
    db.select().from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, tid)),
    db.select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.tenantId, tid)),
    db.select().from(schema.compliance).where(eq(schema.compliance.tenantId, tid)).then((r) => r[0] || null),
    db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.tenantId, tid)).then((r) => r[0] || null)
  ]);

  // Live Digitide data if this tenant is provisioned and operator is reachable.
  let info: any = null, employees: any[] = [];
  if (tenant.telroiDomain) {
    try {
      const op = await OperatorClient.fromPlatform();
      [info, employees] = await Promise.all([
        op.getDomain(tenant.telroiDomain).catch(() => null),
        op.listEmployees(tenant.telroiDomain).catch(() => [])
      ]);
    } catch { /* operator unreachable */ }
  }

  // Voice activity summary — best-effort recent calls from the client's PBX.
  // Lets the operator see whether voice is actually flowing for this client.
  let voice: any = { available: false, recentCount: 0, recent: [] as any[] };
  if (tenant.telroiDomain && tenant.telroiApiKeyEnc) {
    try {
      const tc = TelroiClient.forTenant(tenant);
      const calls = await tc.historyJson({ period: 'week', limit: 5, processMissed: true });
      const list = Array.isArray(calls) ? calls : ((calls as any)?.items || []);
      voice = {
        available: true,
        recentCount: list.length,
        recent: list.slice(0, 5).map((c: any) => ({
          from: c.caller || c.from || c.src || '—',
          to: c.callee || c.to || c.dst || '—',
          when: c.start || c.time || c.date || null,
          status: c.status || c.disposition || '—'
        }))
      };
    } catch { /* voice not reachable — leave unavailable */ }
  }

  // Merge locally-recorded call attempts (failures + non-PBX carrier calls) so
  // the operator sees a complete picture per client, not just PBX history.
  try {
    const { desc } = await import('drizzle-orm');
    const local = await db.select().from(schema.callEvents)
      .where(eq(schema.callEvents.tenantId, tenant.id))
      .orderBy(desc(schema.callEvents.startedAt)).limit(10);
    if (local.length) {
      const localRecent = local.map((e) => ({
        from: (e.raw as any)?.from || '—',
        to: e.phone || '—',
        when: (e.startedAt || e.createdAt)?.toISOString?.() || null,
        status: e.status === 'failed' ? `Failed${(e.raw as any)?.reason ? ' · ' + (e.raw as any).reason : ''}` : (e.status || 'placed'),
        failed: e.status === 'failed'
      }));
      voice.available = true;
      voice.recent = [...localRecent, ...(voice.recent || [])].slice(0, 8);
      voice.recentCount = (voice.recentCount || 0) + localRecent.length;
    }
  } catch { /* local merge best-effort */ }
  return {
    tenant: { id: tid, name: tenant.name, slug: tenant.slug, domain: tenant.telroiDomain || `${tenant.slug}.telroi.ai`, provisioned: !!tenant.telroiDomain, createdAt: tenant.createdAt,
      plan: tenant.plan, trialPlan: tenant.trialPlan, trialEndsAt: tenant.trialEndsAt, trialDays: tenant.trialDays,
      paymentProviderOverride: tenant.paymentProviderOverride || null, sandbox: tenant.sandboxMode, country: tenant.country || null, businessPhone: tenant.businessPhone || null },
    wallet: wallet ? { balanceMinor: wallet.balanceMinor, currency: wallet.currency, plan: wallet.plan } : null,
    numbers: subs.map((n) => ({ id: n.id, telnum: n.telnum, region: n.region, provider: n.provider, channels: n.channels, status: n.status, departmentId: n.departmentId })),
    vans: vans.map((v) => ({ id: v.id, name: v.name, telnum: v.telnum, status: v.status, provider: v.provider, escalateTo: v.escalateTo })),
    flows: flows.map((f) => ({ name: f.name })),
    ai: ai.map((a) => ({ provider: a.provider })),
    team: members,
    policy: tenant.policyAcceptedAt ? { acceptedAt: tenant.policyAcceptedAt, version: tenant.policyVersion } : null,
    card: paymentMethod ? { brand: paymentMethod.brand, last4: paymentMethod.last4, expMonth: paymentMethod.expMonth, expYear: paymentMethod.expYear, provider: paymentMethod.provider } : null,
    compliance: compliance ? {
      status: compliance.status,
      officialName: compliance.officialName,
      submittedAt: compliance.submittedAt,
      reviewedAt: compliance.reviewedAt,
      notes: compliance.notes,
      businessLicenseName: compliance.businessLicenseName,
      hasBusinessDoc: !!compliance.businessLicenseKey,
      regulatoryLicenseName: compliance.regulatoryLicenseName,
      hasRegulatoryDoc: !!compliance.regulatoryLicenseKey
    } : null,
    info, employees, voice
  };
});
