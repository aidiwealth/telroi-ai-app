// GET /api/admin/tasks -> the operator's action queue: real things the admin
// must sort out, derived from live state so each item disappears once resolved.
// These are TASKS (client requests + critical issues), not system log messages.
import { eq, and, isNull } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const tasks: any[] = [];

  // Helper to resolve a tenant's display name + domain for deep-links.
  const tenants = await db.select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, domain: schema.tenants.telroiDomain, onboardingStep: schema.tenants.onboardingStep, isInternal: schema.tenants.isInternal }).from(schema.tenants);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const domainFor = (tid: string) => byId.get(tid)?.domain || byId.get(tid)?.slug || tid;

  // 1) Compliance submissions awaiting review (client requests).
  const pendingKyc = await db.select().from(schema.compliance).where(eq(schema.compliance.status, 'pending'));
  for (const c of pendingKyc) {
    const t = byId.get(c.tenantId); if (!t || t.isInternal) continue;
    tasks.push({
      id: `kyc-${c.tenantId}`, kind: 'request', priority: 1,
      title: `Review compliance docs — ${t.name}`,
      desc: 'A client submitted business/regulatory documents that need approval before they can go live.',
      action: { label: 'Review', to: `/admin/clients/${encodeURIComponent(domainFor(c.tenantId))}` }
    });
  }

  // 2) Workspaces awaiting provisioning (finished onboarding, no PBX yet).
  for (const t of tenants) {
    if (t.isInternal) continue;
    if (!t.domain && (t.onboardingStep ?? 0) >= 5) {
      tasks.push({
        id: `prov-${t.id}`, kind: 'issue', priority: 2,
        title: `Provision voice — ${t.name}`,
        desc: 'This workspace finished onboarding but its voice service isn’t provisioned yet.',
        action: { label: 'Open client', to: `/admin/clients/${encodeURIComponent(t.domain || t.slug || t.id)}` }
      });
    }
  }

  // 3) Client-created AI Numbers still in draft → admin activation.
  const draftVans = await db.select().from(schema.vans).where(eq(schema.vans.status, 'draft'));
  for (const v of draftVans) {
    const t = byId.get(v.tenantId); if (!t || t.isInternal) continue;
    tasks.push({
      id: `van-${v.id}`, kind: 'request', priority: 3,
      title: `Activate AI Number — ${t.name}`,
      desc: `"${v.name}" (${v.telnum}) is set up by the client and waiting to be switched live.`,
      action: { label: 'Activate', to: `/admin/clients/${encodeURIComponent(domainFor(v.tenantId))}` }
    });
  }

  // 4) Numbers that failed to provision at the carrier (critical).
  const failedNums = await db.select().from(schema.numberInventory).where(eq(schema.numberInventory.provisionStatus, 'failed'));
  for (const n of failedNums) {
    tasks.push({
      id: `num-${n.id}`, kind: 'issue', priority: 1,
      title: `Number failed to provision — ${n.telnum}`,
      desc: `${n.telnum} (${n.region}) failed to activate at the carrier and needs attention.`,
      action: { label: 'Inventory', to: '/admin/inventory' }
    });
  }

  // 5) Support workspace wallet empty (critical — support can't place calls).
  const settings = await db.select().from(schema.platformSettings).limit(1);
  const supportTid = settings[0]?.supportTenantId;
  if (supportTid) {
    const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, supportTid)).limit(1);
    if (w && w.balanceMinor <= 0) tasks.push({
      id: 'support-float', kind: 'issue', priority: 2,
      title: 'Support line wallet is empty',
      desc: 'The Telroi Support workspace has no float, so support can’t place client calls.',
      action: { label: 'Add float', to: '/admin/settings' }
    });
  }

  tasks.sort((a, b) => a.priority - b.priority);
  return { tasks };
});
