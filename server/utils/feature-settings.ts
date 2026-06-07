// server/utils/feature-settings.ts
// Two-layer settings for Telroi One features with admin defaults + locks.
// Effective = platformDefaults  ⟵ tenantOverrides, except keys in `locks`
// which always come from the platform default and are read-only for clients.
import { and, eq, isNull } from 'drizzle-orm';
import { useDb, schema } from '../db';

export type Feature = 'crm' | 'live_call' | 'apps';

// The catalog: every editable setting, its default, and its type. Admin defaults
// override these; clients edit within what isn't locked.
export const SETTINGS_CATALOG: Record<Feature, Record<string, { type: string; default: any; label: string }>> = {
  crm: {
    defaultStatus: { type: 'select', default: 'lead', label: 'Default status for new contacts' },
    autoLinkCalls: { type: 'bool', default: true, label: 'Auto-create contacts from inbound calls' },
    dedupeByPhone: { type: 'bool', default: true, label: 'Merge duplicates by phone number' },
    allowBulkImport: { type: 'bool', default: true, label: 'Allow bulk contact import' }
  },
  live_call: {
    bubbleColor: { type: 'color', default: '#1a4b72', label: 'Call button color' },
    bubblePosition: { type: 'select', default: 'middle-right', label: 'Button position' },
    greeting: { type: 'text', default: 'Need help? Call us.', label: 'Greeting text' },
    routeTo: { type: 'select', default: 'agent', label: 'Route calls to' }, // agent | ai
    callProvider: { type: 'select', default: 'auto', label: 'Voice provider' }, // auto | asterisk | ruach | sotel | digidite | telnyx | twilio (operator-only)
    routeTeamId: { type: 'select', default: '', label: 'Team to handle calls' },   // department id (when routeTo=agent)
    aiAgentId: { type: 'select', default: '', label: 'AI agent to answer' },        // ai_agents id (when routeTo=ai)
    csatEnabled: { type: 'bool', default: true, label: 'Ask for satisfaction rating after calls' },
    trackLocation: { type: 'bool', default: true, label: 'Track visitor location' },
    businessHoursEnabled: { type: 'bool', default: false, label: 'Only show the widget during business hours' },
    businessHours: { type: 'hours', default: { tz: 'UTC', days: { mon: ['09:00','17:00'], tue: ['09:00','17:00'], wed: ['09:00','17:00'], thu: ['09:00','17:00'], fri: ['09:00','17:00'], sat: null, sun: null } }, label: 'Business hours' }
  },
  apps: {
    showApps: { type: 'bool', default: true, label: 'Show device apps' },
    showIntegrations: { type: 'bool', default: true, label: 'Show integrations' },
    allowedIntegrations: { type: 'multi', default: ['zapier', 'pipedrive', 'hubspot', 'zoho'], label: 'Available integrations' }
  }
};

function catalogDefaults(feature: Feature): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(SETTINGS_CATALOG[feature])) out[k] = v.default;
  return out;
}

async function platformRow(feature: Feature) {
  const db = useDb();
  const [row] = await db.select().from(schema.featureSettings)
    .where(and(isNull(schema.featureSettings.tenantId), eq(schema.featureSettings.feature, feature))).limit(1);
  return row || null;
}
async function tenantRow(tenantId: string, feature: Feature) {
  const db = useDb();
  const [row] = await db.select().from(schema.featureSettings)
    .where(and(eq(schema.featureSettings.tenantId, tenantId), eq(schema.featureSettings.feature, feature))).limit(1);
  return row || null;
}

// Effective settings for a client, plus which keys are locked (read-only to them).
// Keys that are operator-only: clients never see or choose these (e.g. the
// underlying carrier). They remain configurable in the admin console.
const OPERATOR_ONLY: Record<string, string[]> = { live_call: ['callProvider'] };

export async function effectiveSettings(tenantId: string, feature: Feature, opts?: { forClient?: boolean }) {
  const pf = await platformRow(feature);
  const tn = await tenantRow(tenantId, feature);
  const base = { ...catalogDefaults(feature), ...(pf?.settings || {}) };
  const locks = (pf?.locks || []) as string[];
  const merged = { ...base, ...(tn?.settings || {}) };
  // Locked keys always take the platform/admin value.
  for (const k of locks) merged[k] = base[k];
  let catalog: any = SETTINGS_CATALOG[feature];
  // For client responses, strip operator-only fields so vendor/carrier choices
  // are never exposed; the client always gets the region-resolved default.
  if (opts?.forClient) {
    const hide = OPERATOR_ONLY[feature] || [];
    if (hide.length) {
      catalog = { ...catalog };
      for (const k of hide) delete catalog[k];
    }
  }
  return { settings: merged, locks, catalog };
}

// Save a client's settings (ignores locked keys — they can't change those).
export async function saveTenantSettings(tenantId: string, feature: Feature, incoming: Record<string, any>) {
  const db = useDb();
  const pf = await platformRow(feature);
  const locks = (pf?.locks || []) as string[];
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (locks.includes(k)) continue;             // locked — silently ignore
    if (k in SETTINGS_CATALOG[feature]) clean[k] = v;
  }
  const existing = await tenantRow(tenantId, feature);
  if (existing) {
    await db.update(schema.featureSettings)
      .set({ settings: { ...(existing.settings || {}), ...clean }, updatedAt: new Date() })
      .where(eq(schema.featureSettings.id, existing.id));
  } else {
    await db.insert(schema.featureSettings).values({ tenantId, feature, settings: clean });
  }
  return effectiveSettings(tenantId, feature);
}

// Admin: save platform defaults + locks for a feature.
export async function savePlatformSettings(feature: Feature, settings: Record<string, any>, locks: string[]) {
  const db = useDb();
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(settings || {})) if (k in SETTINGS_CATALOG[feature]) clean[k] = v;
  const validLocks = (locks || []).filter((k) => k in SETTINGS_CATALOG[feature]);
  const existing = await platformRow(feature);
  if (existing) {
    await db.update(schema.featureSettings)
      .set({ settings: { ...(existing.settings || {}), ...clean }, locks: validLocks, updatedAt: new Date() })
      .where(eq(schema.featureSettings.id, existing.id));
  } else {
    await db.insert(schema.featureSettings).values({ tenantId: null as any, feature, settings: clean, locks: validLocks });
  }
  return { settings: { ...catalogDefaults(feature), ...clean }, locks: validLocks, catalog: SETTINGS_CATALOG[feature] };
}

export async function platformSettingsView(feature: Feature) {
  const pf = await platformRow(feature);
  return { settings: { ...catalogDefaults(feature), ...(pf?.settings || {}) }, locks: (pf?.locks || []) as string[], catalog: SETTINGS_CATALOG[feature] };
}

// ── Admin per-client granularity ──
// Admin views/edits a SPECIFIC client's settings. This writes the tenant-scoped
// row directly (admin can change values clients can't, but locked keys still
// reflect the platform default for consistency). Returns the same shape.
export async function adminTenantSettingsView(tenantId: string, feature: Feature) {
  return effectiveSettings(tenantId, feature);
}
export async function adminSaveTenantSettings(tenantId: string, feature: Feature, incoming: Record<string, any>) {
  const db = useDb();
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(incoming || {})) if (k in SETTINGS_CATALOG[feature]) clean[k] = v;
  const existing = await tenantRow(tenantId, feature);
  if (existing) {
    await db.update(schema.featureSettings)
      .set({ settings: { ...(existing.settings || {}), ...clean }, updatedAt: new Date() })
      .where(eq(schema.featureSettings.id, existing.id));
  } else {
    await db.insert(schema.featureSettings).values({ tenantId, feature, settings: clean });
  }
  return effectiveSettings(tenantId, feature);
}
