// server/utils/sandbox.ts
// Single source of truth for whether a workspace is in sandbox mode. Used to
// short-circuit real money movement and external carrier/PBX calls so sandbox
// actions are fully simulated.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function isSandbox(tenantId: string): Promise<boolean> {
  const db = useDb();
  const [t] = await db.select({ s: schema.tenants.sandboxMode }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  // Default to sandbox (safe) if the tenant can't be resolved.
  return t ? !!t.s : true;
}
