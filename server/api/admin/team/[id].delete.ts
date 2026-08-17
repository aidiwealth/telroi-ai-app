// DELETE /api/admin/team/:id -> remove an operator. Superadmin only.
// Guards: can't remove yourself, can't remove the last superadmin.
import { eq, and, ne } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [target] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.id, id)).limit(1);
  if (!target) throw apiError('not_found', 'Operator not found', 404);
  if (target.email === admin.email) throw apiError('self', 'You can’t remove your own access.', 400);

  if (target.role === 'superadmin') {
    const others = await db.select().from(schema.platformAdmins)
      .where(and(eq(schema.platformAdmins.role, 'superadmin'), ne(schema.platformAdmins.id, id)));
    if (others.length === 0) throw apiError('last_superadmin', 'You can’t remove the last superadmin.', 400);
  }

  // An operator's console reaches every client's data, so their sessions ending
  // with their access matters more here than anywhere.
  const [op] = await db.select({ email: schema.platformAdmins.email })
    .from(schema.platformAdmins).where(eq(schema.platformAdmins.id, id)).limit(1);
  if (op?.email) {
    const { revokeSessions } = await import('~/server/utils/session');
    await revokeSessions({ adminEmail: op.email, reason: 'removed from platform' });
  }

  await db.delete(schema.platformAdmins).where(eq(schema.platformAdmins.id, id));

  // Their calling goes with their access. Deleting only the admin row left the
  // SIP endpoint registered and the person still in whatever departments they
  // belonged to — so somebody who had left kept receiving support calls, and any
  // softphone they'd configured kept working indefinitely.
  try {
    const { ensureSupportWorkspace } = await import('~/server/utils/support');
    const { agentDeprovision } = await import('~/server/utils/provision-agent');
    const ws = await ensureSupportWorkspace();

    await db.delete(schema.departmentMembers)
      .where(and(eq(schema.departmentMembers.tenantId, ws.tenantId), eq(schema.departmentMembers.userId, id)));

    // Both halves matter: the row is what our routing reads, and the Asterisk
    // endpoint is what a softphone registers against. Removing only the row
    // leaves working credentials behind.
    const eps = await db.select().from(schema.sipEndpoints)
      .where(eq(schema.sipEndpoints.tenantId, ws.tenantId));
    for (const ep of eps) {
      if ((ep.meta as any)?.userId !== id || !ep.sipUsername) continue;
      try { await agentDeprovision(ep.sipUsername); } catch (e: any) {
        console.error(`[team.remove] ${ep.sipUsername} still on the PBX:`, e?.message);
      }
      await db.delete(schema.sipEndpoints).where(eq(schema.sipEndpoints.id, ep.id));
    }
  } catch (e: any) {
    console.error('[team.remove] access revoked but calling not fully removed:', e?.message);
  }

  await logEvent({ kind: 'system', action: 'team.remove', summary: `${admin.email} removed operator ${target.email}` });
  return { ok: true };
});
