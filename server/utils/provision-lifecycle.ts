// server/utils/provision-lifecycle.ts
// Local-first provisioning. Resources live in OUR DB at zero vendor cost until
// go-live; then we provision the COUNTRY's vendor lazily:
//   Nigeria          -> Digidite PBX (deferred entirely; account/team at go-live,
//                       seats/numbers on first use)
//   everywhere else  -> carrier (Twilio/Telnyx) provisioned by admin; numbers
//                       may be provisioned early by admin, else on first use.
// Billing: NO wallet debits while 'local'. Real vendor charges begin only when a
// resource is actually provisioned. Every push is recorded in provisioningEvents.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { voiceVendorForCountry, isNigeria } from './countries';
import { logEvent } from './logs';

async function recordEvent(tenantId: string, resource: string, vendor: string, status: string, detail?: string, resourceRef?: string) {
  try {
    const db = useDb();
    await db.insert(schema.provisioningEvents).values({ tenantId, resource, resourceRef: resourceRef || null, vendor, status, detail: detail || null });
  } catch { /* audit best-effort */ }
}

// Called when a tenant goes LIVE (compliance approved + switched off sandbox).
// Provisions the account/team on the country's vendor. Seats/numbers stay lazy.
export async function provisionOnGoLive(tenantId: string): Promise<{ ok: boolean; vendor: string; reason?: string }> {
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!t) return { ok: false, vendor: 'none', reason: 'tenant_not_found' };

  const vendor = voiceVendorForCountry(t.country);

  // Mark provisioning in progress.
  await db.update(schema.tenants).set({ provisionState: 'provisioning', wentLiveAt: t.wentLiveAt || new Date() }).where(eq(schema.tenants.id, tenantId));

  if (vendor === 'digidite') {
    // Nigeria: create the Digidite account/team now (this is the costly step we
    // deferred until go-live). Seats/numbers remain lazy.
    try {
      const { provisionTenant } = await import('./provisioning');
      const r = await provisionTenant(tenantId);
      if (r.ok) {
        await db.update(schema.tenants).set({ provisionState: 'provisioned' }).where(eq(schema.tenants.id, tenantId));
        await recordEvent(tenantId, 'tenant_account', 'digidite', 'provisioned', r.domain);
        await logEvent({ tenantId, kind: 'system', action: 'provision.golive', summary: `Digidite account provisioned (${r.domain})` });
        return { ok: true, vendor: 'digidite' };
      }
      await db.update(schema.tenants).set({ provisionState: 'local' }).where(eq(schema.tenants.id, tenantId));
      await recordEvent(tenantId, 'tenant_account', 'digidite', 'failed', r.reason);
      return { ok: false, vendor: 'digidite', reason: r.reason };
    } catch (e: any) {
      await db.update(schema.tenants).set({ provisionState: 'local' }).where(eq(schema.tenants.id, tenantId));
      await recordEvent(tenantId, 'tenant_account', 'digidite', 'failed', e?.message);
      return { ok: false, vendor: 'digidite', reason: e?.message };
    }
  }

  // Non-Nigeria: carrier model. The carrier "account" is Telroi's master account
  // (no per-tenant account to create) — numbers are provisioned per-number,
  // lazily on first use (or early by admin). So go-live just marks ready.
  await db.update(schema.tenants).set({ provisionState: 'provisioned' }).where(eq(schema.tenants.id, tenantId));
  await recordEvent(tenantId, 'tenant_account', 'carrier', 'provisioned', 'carrier master account — numbers provisioned per-use');
  await logEvent({ tenantId, kind: 'system', action: 'provision.golive', summary: 'Carrier-backed workspace marked live' });
  return { ok: true, vendor: 'carrier' };
}

// Lazily ensure a NUMBER is provisioned on its vendor before it's used for a
// call. Returns ok=true if already/just provisioned. Begins billing at this point.
export async function ensureNumberProvisioned(tenantId: string, subscriptionId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const [sub] = await db.select().from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.id, subscriptionId)).limit(1);
  if (!t || !sub) return { ok: false, reason: 'not_found' };

  // While the tenant is still local/sandbox, never provision (free local usage).
  if (t.sandboxMode || t.provisionState === 'local') return { ok: false, reason: 'tenant_local' };
  if (sub.provisionState === 'provisioned') return { ok: true };

  const nigeria = isNigeria(t.country);
  try {
    await db.update(schema.numberSubscriptions).set({ provisionState: 'provisioning' }).where(eq(schema.numberSubscriptions.id, subscriptionId));
    // Numbers are ALREADY purchased + provisioned on their carrier/PBX out-of-band
    // (Twilio/Telnyx in their consoles; Digidite on the PBX). We do NOT call any
    // carrier API here — going "live" for a number just means marking it active
    // for this tenant and beginning billing. Webhooks are registered manually in
    // the carrier console (or once, globally), not per-number.
    const ref = `${nigeria ? 'digidite' : (sub.provider || 'carrier')}:${sub.telnum}`;

    await db.update(schema.numberSubscriptions)
      .set({ provisionState: 'provisioned', provisionRef: ref, provisionedAt: new Date() })
      .where(eq(schema.numberSubscriptions.id, subscriptionId));
    await recordEvent(tenantId, 'number', nigeria ? 'digidite' : (sub.provider || 'carrier'), 'provisioned', ref, sub.telnum);

    // Begin billing: charge the monthly DID fee now that the number is active.
    try {
      const { chargeNumberProvision } = await import('./wallet');
      if (chargeNumberProvision) await chargeNumberProvision(tenantId, sub.telnum);
    } catch { /* billing hook optional */ }

    return { ok: true };
  } catch (e: any) {
    await db.update(schema.numberSubscriptions).set({ provisionState: 'local' }).where(eq(schema.numberSubscriptions.id, subscriptionId));
    await recordEvent(tenantId, 'number', nigeria ? 'digidite' : (sub.provider || 'carrier'), 'failed', e?.message, sub.telnum);
    return { ok: false, reason: e?.message };
  }
}
