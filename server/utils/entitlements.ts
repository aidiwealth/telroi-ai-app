// server/utils/entitlements.ts
// Single source of truth for plan + feature access. Resolves a tenant's
// EFFECTIVE plan (accounting for an active trial), then whether a given feature
// key is unlocked — taking per-client overrides into account.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

// Default feature catalog — mirrors the marketing pricing matrix. Seeded into
// plan_features; admin can edit. Core voice is on every plan; the Telroi One
// suite unlocks on growth+.
export const DEFAULT_FEATURES: { key: string; label: string; startup: boolean; growth: boolean; custom: boolean }[] = [
  // Core voice — all plans
  { key: 'van', label: 'AI call answering (VAN)', startup: true, growth: true, custom: true },
  { key: 'recording', label: 'Call recording & transcription', startup: true, growth: true, custom: true },
  { key: 'api', label: 'Webhooks & API access', startup: true, growth: true, custom: true },
  { key: 'optimize', label: 'Route scoring & fraud detection', startup: true, growth: true, custom: true },
  { key: 'routing', label: 'CLI-compliant voice routing', startup: true, growth: true, custom: true },
  { key: 'numbers', label: 'DID number provisioning', startup: true, growth: true, custom: true },
  { key: 'multilang', label: 'Multi-language AI support', startup: true, growth: true, custom: true },
  // Telroi One suite — growth & custom only
  { key: 'crm', label: 'Telroi CRM — contacts, deals, call logs', startup: false, growth: true, custom: true },
  { key: 'live_call', label: 'Live Call — website & app call widget', startup: false, growth: true, custom: true },
  { key: 'apps', label: 'Apps & Integrations', startup: false, growth: true, custom: true },
  { key: 'dialer', label: 'Desktop dialer (Mac & Windows)', startup: false, growth: true, custom: true },
  { key: 'messenger', label: 'Team messenger', startup: false, growth: true, custom: true },
  { key: 'subdomain', label: 'yourcompany.telroi.ai subdomain', startup: false, growth: true, custom: true },
  { key: 'summaries', label: 'AI call summaries to CRM', startup: false, growth: true, custom: true },
  { key: 'team', label: 'Admin controls & user management', startup: false, growth: true, custom: true },
  { key: 'priority', label: 'Priority support', startup: false, growth: true, custom: true },
  // Custom only
  { key: 'onboarding', label: 'Custom onboarding', startup: false, growth: false, custom: true },
  { key: 'compliance_support', label: 'Dedicated compliance support', startup: false, growth: false, custom: true },
  { key: 'whitelabel', label: 'White-label & on-prem options', startup: false, growth: false, custom: true }
];

export type PlanName = 'startup' | 'growth' | 'custom';

// The effective plan: if a trial is active and not expired, the trial plan wins.
export function effectivePlan(tenant: { plan: string; trialPlan: string | null; trialEndsAt: Date | null }): PlanName {
  if (tenant.trialPlan && tenant.trialEndsAt && new Date(tenant.trialEndsAt).getTime() > Date.now()) {
    return tenant.trialPlan as PlanName;
  }
  return (tenant.plan as PlanName) || 'startup';
}

export function trialActive(tenant: { trialPlan: string | null; trialEndsAt: Date | null }): boolean {
  return !!(tenant.trialPlan && tenant.trialEndsAt && new Date(tenant.trialEndsAt).getTime() > Date.now());
}

export function trialDaysLeft(tenant: { trialEndsAt: Date | null }): number {
  if (!tenant.trialEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / 86400000));
}

// Resolve the full entitlement set for a tenant: { featureKey: boolean }.
export async function entitlementsFor(tenantId: string) {
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) return { plan: 'startup' as PlanName, features: {} as Record<string, boolean>, trial: null as any };

  const plan = effectivePlan(tenant);

  // Load catalog (fall back to defaults if not yet seeded).
  let catalog = await db.select().from(schema.planFeatures);
  if (!catalog.length) catalog = DEFAULT_FEATURES as any;

  // Per-client overrides.
  const overrides = await db.select().from(schema.tenantFeatureOverrides).where(eq(schema.tenantFeatureOverrides.tenantId, tenantId));
  const ovMap = new Map(overrides.map((o) => [o.featureKey, o.enabled]));

  const features: Record<string, boolean> = {};
  for (const f of catalog) {
    const planAllows = plan === 'startup' ? f.startup : plan === 'growth' ? f.growth : f.custom;
    features[f.key] = ovMap.has(f.key) ? !!ovMap.get(f.key) : planAllows;
  }

  // Telroi One sub-features: if the catalog doesn't list them (older seed),
  // make them inherit CRM access unless an explicit per-client override exists,
  // so the client UI and server guards agree.
  for (const k of ['live_call', 'apps']) {
    if (!(k in features)) features[k] = ovMap.has(k) ? !!ovMap.get(k) : !!features['crm'];
  }

  return {
    plan,
    features,
    trial: trialActive(tenant) ? { plan: tenant.trialPlan, endsAt: tenant.trialEndsAt, daysLeft: trialDaysLeft(tenant) } : null
  };
}

// AI subscription wall: AI features (VAN answering, agents) require an ACTIVE
// subscription — the workspace must have selected a plan and be either on a paid
// plan or an active trial (trial counts). This is the single source of truth for
// AI gating, enforced server-side at every AI entry point and mirrored in the UI.
export async function aiActive(tenantId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) return { ok: false, reason: 'no_workspace' };
  if (!tenant.planSelected) return { ok: false, reason: 'no_plan' };
  // Active = an unexpired trial, OR a real (non-trial) plan the workspace is on.
  const active = trialActive(tenant) || !!tenant.planSelected;
  if (!active) return { ok: false, reason: 'inactive' };
  // Respect the feature catalog / per-client overrides for the AI (van) feature.
  const has = await hasFeature(tenantId, 'van');
  if (!has) return { ok: false, reason: 'not_entitled' };
  return { ok: true };
}

// Convenience guard for API routes.
export async function hasFeature(tenantId: string, key: string): Promise<boolean> {
  const e = await entitlementsFor(tenantId);
  // Live Call and Apps are part of the Telroi One bundle. If the platform's
  // feature catalog doesn't list them explicitly (older seed), fall back to the
  // CRM entitlement so they inherit Telroi One access — unless an explicit
  // per-client override exists for that specific key.
  if ((key === 'live_call' || key === 'apps') && !(key in e.features)) {
    return !!e.features['crm'];
  }
  return !!e.features[key];
}
