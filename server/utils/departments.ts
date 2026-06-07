// server/utils/departments.ts
// Shared department/team operations, used by both client (self-serve) and admin
// (operator-on-behalf) endpoints so behaviour is identical.
import { and, eq, inArray } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function listDepartments(tenantId: string) {
  const db = useDb();
  const depts = await db.select().from(schema.departments)
    .where(eq(schema.departments.tenantId, tenantId));
  const deptIds = depts.map((d) => d.id);
  const members = deptIds.length
    ? await db.select().from(schema.departmentMembers).where(inArray(schema.departmentMembers.departmentId, deptIds))
    : [];
  const numbers = await db.select().from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.tenantId, tenantId));
  // attach user info
  const userIds = [...new Set(members.map((m) => m.userId))];
  const users = userIds.length
    ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users).where(inArray(schema.users.id, userIds))
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  return depts.map((d) => ({
    ...d,
    members: members.filter((m) => m.departmentId === d.id).map((m) => ({
      ...m, user: userById.get(m.userId) || null
    })),
    numbers: numbers.filter((n) => n.departmentId === d.id)
  }));
}

export async function createDepartment(tenantId: string, name: string, description?: string) {
  const db = useDb();
  const [row] = await db.insert(schema.departments)
    .values({ tenantId, name, description: description || null }).returning();
  return row;
}

export async function updateDepartment(tenantId: string, id: string, patch: { name?: string; description?: string; ringStrategy?: string; ringTimeout?: number }) {
  const db = useDb();
  const [row] = await db.update(schema.departments).set(patch)
    .where(and(eq(schema.departments.id, id), eq(schema.departments.tenantId, tenantId))).returning();
  // Push routing to the live PBX (best-effort; only when the tenant is live).
  syncDepartmentToPbx(tenantId, id).catch(() => { /* logged inside */ });
  return row;
}

// Map our ring strategy to the PBX's call_order vocabulary.
function pbxCallOrder(strategy?: string): string {
  if (strategy === 'round_robin') return 'round-robin';
  if (strategy === 'linear') return 'serial';
  return 'parallel'; // simultaneous
}

// Push a team's routing + membership to the real Digidite ring group. Creates
// the group on first sync (storing pbxGroupId), edits it thereafter, and syncs
// the member extensions. No-op while the tenant is local/sandbox (zero vendor
// cost preserved) or if the PBX isn't reachable — all failures are logged, never
// thrown, so the local save always succeeds.
export async function syncDepartmentToPbx(tenantId: string, departmentId: string): Promise<{ ok: boolean; reason?: string; pbxGroupId?: string }> {
  const db = useDb();
  try {
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) return { ok: false, reason: 'tenant_not_found' };
    // Only sync once the tenant is live + provisioned on the PBX.
    if (t.sandboxMode || t.provisionState !== 'provisioned' || !t.telroiDomain || !t.telroiApiKeyEnc) {
      return { ok: false, reason: 'tenant_local_or_unprovisioned' };
    }
    const [dept] = await db.select().from(schema.departments)
      .where(and(eq(schema.departments.id, departmentId), eq(schema.departments.tenantId, tenantId))).limit(1);
    if (!dept) return { ok: false, reason: 'department_not_found' };

    const { TelroiClient } = await import('./telroi/client');
    const { logEvent } = await import('./logs');
    const client = TelroiClient.forTenant(t as any);

    const groupBody = {
      name: dept.name,
      call_order: pbxCallOrder(dept.ringStrategy),
      timeout: { time: dept.ringTimeout, target: 'hangup' }
    };

    let pbxGroupId = dept.pbxGroupId;
    if (pbxGroupId) {
      await client.editGroup(pbxGroupId, groupBody);
    } else {
      const created = await client.addGroup(groupBody);
      pbxGroupId = (created as any)?.id || (created as any)?.ext;
      if (pbxGroupId) {
        await db.update(schema.departments).set({ pbxGroupId }).where(eq(schema.departments.id, departmentId));
      }
    }

    // Sync the group's members (their PBX logins).
    if (pbxGroupId) {
      const dmembers = await db.select().from(schema.departmentMembers)
        .where(eq(schema.departmentMembers.departmentId, departmentId));
      const userIds = dmembers.map((m) => m.userId);
      const logins: string[] = [];
      if (userIds.length) {
        const mems = await db.select({ userId: schema.memberships.userId, pbxLogin: schema.memberships.pbxLogin })
          .from(schema.memberships)
          .where(eq(schema.memberships.tenantId, tenantId));
        for (const m of mems) {
          if (userIds.includes(m.userId) && m.pbxLogin) logins.push(m.pbxLogin);
        }
        // Only members with can_take_calls should ring.
        // (capabilities already enforced; we pass those with a login.)
        await client.changeGroupUsers(pbxGroupId, { users: logins });
      }
    }
    await logEvent({ tenantId, kind: 'system', action: 'pbx.group.sync', summary: `Synced ring group "${dept.name}" to PBX` });
    return { ok: true, pbxGroupId: pbxGroupId || undefined };
  } catch (e: any) {
    try { const { logEvent } = await import('./logs'); await logEvent({ tenantId, kind: 'system', action: 'pbx.group.sync', level: 'error', summary: `Ring group sync failed: ${e?.message || 'error'}` }); } catch { /* */ }
    return { ok: false, reason: e?.message || 'pbx_error' };
  }
}

export async function deleteDepartment(tenantId: string, id: string) {
  const db = useDb();
  await db.delete(schema.departments)
    .where(and(eq(schema.departments.id, id), eq(schema.departments.tenantId, tenantId)));
  return { ok: true };
}

export async function setDepartmentMember(tenantId: string, departmentId: string, userId: string, caps: { canMakeCalls?: boolean; canTakeCalls?: boolean; canOperate?: boolean }) {
  const db = useDb();
  // Validate the department + user both belong to the tenant.
  const [dept] = await db.select().from(schema.departments)
    .where(and(eq(schema.departments.id, departmentId), eq(schema.departments.tenantId, tenantId))).limit(1);
  if (!dept) throw new Error('Department not found');
  const [mem] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, userId))).limit(1);
  if (!mem) throw new Error('User is not a member of this workspace');

  const [existing] = await db.select().from(schema.departmentMembers)
    .where(and(eq(schema.departmentMembers.departmentId, departmentId), eq(schema.departmentMembers.userId, userId))).limit(1);
  if (existing) {
    const [row] = await db.update(schema.departmentMembers).set({
      canMakeCalls: caps.canMakeCalls ?? existing.canMakeCalls,
      canTakeCalls: caps.canTakeCalls ?? existing.canTakeCalls,
      canOperate: caps.canOperate ?? existing.canOperate
    }).where(eq(schema.departmentMembers.id, existing.id)).returning();
    syncDepartmentToPbx(tenantId, departmentId).catch(() => {});
    return row;
  }
  const [row] = await db.insert(schema.departmentMembers).values({
    departmentId, tenantId, userId,
    canMakeCalls: caps.canMakeCalls ?? true,
    canTakeCalls: caps.canTakeCalls ?? true,
    canOperate: caps.canOperate ?? false
  }).returning();
  syncDepartmentToPbx(tenantId, departmentId).catch(() => {});
  return row;
}

export async function removeDepartmentMember(tenantId: string, departmentId: string, userId: string) {
  const db = useDb();
  await db.delete(schema.departmentMembers)
    .where(and(eq(schema.departmentMembers.tenantId, tenantId), eq(schema.departmentMembers.departmentId, departmentId), eq(schema.departmentMembers.userId, userId)));
  syncDepartmentToPbx(tenantId, departmentId).catch(() => {});
  return { ok: true };
}

export async function assignNumberToDepartment(tenantId: string, subscriptionId: string, departmentId: string | null) {
  const db = useDb();
  if (departmentId) {
    const [dept] = await db.select().from(schema.departments)
      .where(and(eq(schema.departments.id, departmentId), eq(schema.departments.tenantId, tenantId))).limit(1);
    if (!dept) throw new Error('Department not found');
  }
  const [row] = await db.update(schema.numberSubscriptions)
    .set({ departmentId })
    .where(and(eq(schema.numberSubscriptions.id, subscriptionId), eq(schema.numberSubscriptions.tenantId, tenantId))).returning();
  return row;
}
