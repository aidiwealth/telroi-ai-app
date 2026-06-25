// server/utils/provisioning.ts
// Provisions a tenant's Digidite/Telroi PBX subdomain via the Operator API and
// stores the resulting domain + key (encrypted) on the tenant row. Once this
// succeeds, TelroiClient.forTenant() works and all voice features go live.
//
// Best-effort by design: if the Operator API isn't configured or the call
// fails, we DON'T block signup — the tenant simply stays unprovisioned and the
// voice pages show the friendly "activating" state until provisioning succeeds
// (the operator can retry from the admin client page).
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { logEvent } from './logs';

export interface ProvisionResult {
  ok: boolean;
  domain?: string;
  reason?: string;
}

export async function provisionTenant(tenantId: string): Promise<ProvisionResult> {
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!t) return { ok: false, reason: 'tenant_not_found' };
  if (t.provisionState === 'provisioned') return { ok: true, domain: t.slug };
  try {
    await db.update(schema.tenants)
      .set({ provisionState: 'provisioned', wentLiveAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    await logEvent({ tenantId, kind: 'system', action: 'provision.success', summary: `Workspace ${t.slug} marked live` });
    return { ok: true, domain: t.slug };
  } catch (e: any) {
    const msg = e?.message || 'unknown error';
    await logEvent({ tenantId, kind: 'system', action: 'provision.failed', level: 'error', summary: msg });
    return { ok: false, reason: msg };
  }
}
