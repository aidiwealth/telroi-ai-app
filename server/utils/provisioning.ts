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
import { encrypt } from './crypto';
import { OperatorClient } from './telroi/operator';
import { platformSettings } from './platform';
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

  // Already provisioned — no-op (idempotent).
  if (t.telroiDomain && t.telroiApiKeyEnc) return { ok: true, domain: t.telroiDomain };

  const settings = await platformSettings();
  if (!settings?.operatorDomain || !settings?.operatorApiKeyEnc) {
    await logEvent({ tenantId, kind: 'system', action: 'provision.skipped', level: 'warn', summary: 'Operator/Digidite API not configured' });
    return { ok: false, reason: 'operator_not_configured' };
  }

  // The client's subdomain: <slug>.<clientDomainSuffix>.
  const suffix = settings.clientDomainSuffix || 'digitaltide.io';
  const domain = `${t.slug}.${suffix}`;

  try {
    const op = await OperatorClient.fromPlatform();
    await op.createDomain(domain, {
      name: t.name,
      language: 'en',
      client: t.slug,
      ownRegion: t.country || undefined
    });

    // Digidite is one shared account (operator credential), so the tenant's CPBX
    // calls authenticate with the same operator key, scoped to its subdomain.
    const apiKeyEnc = settings.operatorApiKeyEnc; // already encrypted in settings
    await db.update(schema.tenants)
      .set({ telroiDomain: domain, telroiApiKeyEnc: apiKeyEnc })
      .where(eq(schema.tenants.id, tenantId));

    await logEvent({ tenantId, kind: 'system', action: 'provision.success', summary: `Provisioned ${domain}` });
    return { ok: true, domain };
  } catch (e: any) {
    // If the domain already exists on the carrier, treat it as provisioned.
    const msg = e?.data?.error?.message || e?.message || 'unknown error';
    if (/exist/i.test(msg)) {
      await db.update(schema.tenants)
        .set({ telroiDomain: domain, telroiApiKeyEnc: settings.operatorApiKeyEnc })
        .where(eq(schema.tenants.id, tenantId));
      await logEvent({ tenantId, kind: 'system', action: 'provision.exists', summary: `Domain ${domain} already existed; linked` });
      return { ok: true, domain };
    }
    await logEvent({ tenantId, kind: 'system', action: 'provision.failed', level: 'error', summary: msg });
    return { ok: false, reason: msg };
  }
}
