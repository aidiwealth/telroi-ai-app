// server/utils/permissions.ts
// Call-capability resolution for a user within a tenant.
//
// Model:
//  - owner / admin  -> implicitly ALL capabilities (make, take, operate) on ALL numbers.
//  - member         -> capabilities come from their department memberships.
//                      A member can make/take calls only if at least one of their
//                      departments grants it, and can only call FROM numbers that
//                      belong to a department they're in (or unassigned numbers if
//                      they have make_calls in any department).
import { and, eq, inArray } from 'drizzle-orm';
import { useDb, schema } from '../db';

export interface CallCaps {
  role: 'owner' | 'admin' | 'member' | null;
  makeCalls: boolean;
  takeCalls: boolean;
  operate: boolean;
  departmentIds: string[];      // departments the user belongs to
  allowedNumberIds: string[] | 'all';  // which number subscriptions they may call from
}

export async function getCallCaps(tenantId: string, userId: string): Promise<CallCaps> {
  const db = useDb();
  const [m] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, userId)))
    .limit(1);
  const role = (m?.role as any) || null;

  if (role === 'owner' || role === 'admin') {
    return { role, makeCalls: true, takeCalls: true, operate: true, departmentIds: [], allowedNumberIds: 'all' };
  }
  if (!role) {
    return { role: null, makeCalls: false, takeCalls: false, operate: false, departmentIds: [], allowedNumberIds: [] };
  }

  // member: aggregate department capabilities
  const dm = await db.select().from(schema.departmentMembers)
    .where(and(eq(schema.departmentMembers.tenantId, tenantId), eq(schema.departmentMembers.userId, userId)));
  const departmentIds = dm.map((d) => d.departmentId);
  const makeCalls = dm.some((d) => d.canMakeCalls);
  const takeCalls = dm.some((d) => d.canTakeCalls);
  const operate = dm.some((d) => d.canOperate);

  // Numbers they may call from: those assigned to their departments.
  let allowedNumberIds: string[] = [];
  if (departmentIds.length) {
    const nums = await db.select({ id: schema.numberSubscriptions.id })
      .from(schema.numberSubscriptions)
      .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), inArray(schema.numberSubscriptions.departmentId, departmentIds)));
    allowedNumberIds = nums.map((n) => n.id);
  }
  return { role, makeCalls, takeCalls, operate, departmentIds, allowedNumberIds };
}

// Can this user place an outbound call FROM the given telnum?
export async function canCallFromNumber(tenantId: string, userId: string, telnum: string): Promise<{ ok: boolean; reason?: string }> {
  const caps = await getCallCaps(tenantId, userId);
  if (!caps.makeCalls) return { ok: false, reason: 'You do not have permission to make calls.' };
  if (caps.allowedNumberIds === 'all') return { ok: true };
  const db = useDb();
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.telnum, telnum)))
    .limit(1);
  if (!sub) return { ok: false, reason: 'Number not found on your account.' };
  // Members may use numbers in their departments. Unassigned numbers are owner/admin-only.
  if (sub.departmentId && caps.departmentIds.includes(sub.departmentId)) return { ok: true };
  return { ok: false, reason: 'This number is not assigned to your team.' };
}
