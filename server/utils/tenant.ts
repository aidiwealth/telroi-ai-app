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
  // A sandbox tenant gets the simulation, so voice, AI and every PBX-backed
  // screen works during a trial with no vendor calls. That is the only reason
  // to substitute one.
  if (tenant.sandboxMode) {
    const { SandboxTelroiClient } = await import('./telroi/sandbox-client');
    return new SandboxTelroiClient(tenantId) as any;
  }

  // A live tenant gets the real client whatever its provision state. This used
  // to require 'provisioned' as well, which conflated two independent things:
  // whether a workspace is trialling, and whether it sits on a remote PBX or
  // our own. A live workspace on 'local' failed the second test and was handed
  // the simulation — so its 258 real calls came back as an empty list, with no
  // error, for as long as nobody thought to read the code.
  //
  // Substituting for a trial is a kindness. Substituting for a live workspace
  // is a lie, and one that reads as an absence rather than a fault.
  const { AsteriskClient } = await import('./telroi/asterisk-client');
  return AsteriskClient.forTenant(tenant) as any;
}

