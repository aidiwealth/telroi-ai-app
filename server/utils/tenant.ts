// server/utils/tenant.ts
// Loads a tenant row and constructs its Telroi client. Enforces tenant scoping.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { apiError } from './api';

export async function loadTenant(tenantId: string) {
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) throw apiError('no_tenant', 'Workspace not found', 404);
  return tenant;
}

export async function telroiFor(tenantId: string) {
  const tenant = await loadTenant(tenantId);
  // Sandbox / not-yet-live tenants use the simulation client so voice, AI and
  // every PBX-backed feature works during a trial with no vendor calls. Once the
  // tenant is live + provisioned (real PBX domain present), use the real client.
  const isLive = !tenant.sandboxMode && tenant.provisionState === 'provisioned';
  if (!isLive) {
    const { SandboxTelroiClient } = await import('./telroi/sandbox-client');
    return new SandboxTelroiClient(tenantId) as any;
  }
  const { AsteriskClient } = await import('./telroi/asterisk-client');
  return AsteriskClient.forTenant(tenant) as any;
}
