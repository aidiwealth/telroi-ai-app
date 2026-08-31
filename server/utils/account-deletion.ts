/**
 * Removing an account, as both app stores require it be possible from inside
 * the app.
 *
 * Anonymised rather than erased. A person is referenced by call ratings, notes,
 * memberships and audit entries, and those records belong to the workspace
 * rather than to them — the privacy policy says so about recordings, and the
 * same reasoning holds for the rest. Cascading a delete through all of it would
 * destroy an organisation's history to satisfy one person's departure, which is
 * neither what they asked for nor what the regulation requires: the obligation
 * is to remove personal data, not every row that once touched it.
 */
import { and, eq, ne } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export type DeletionOutcome =
  | { ok: true; closedWorkspace: boolean }
  | { ok: false; reason: 'transfer_first'; owners: number; members: number };

/** Who else is in this workspace, and are any of them able to take it on. */
export async function workspaceStanding(tenantId: string, userId: string) {
  const db = useDb();
  const rows = await db.select({
    userId: schema.memberships.userId,
    role: schema.memberships.role
  }).from(schema.memberships).where(eq(schema.memberships.tenantId, tenantId));

  const mine = rows.find((r) => r.userId === userId);
  const others = rows.filter((r) => r.userId !== userId);
  return {
    isOwner: mine?.role === 'owner',
    others: others.length,
    otherOwners: others.filter((r) => r.role === 'owner').length
  };
}

/**
 * Take the person out of the record while leaving the record standing.
 *
 * The users table holds two things about somebody: their email and their name.
 * The email is replaced rather than nulled because it carries a unique index,
 * and a second deletion would collide with the first.
 */
export async function anonymiseUser(userId: string) {
  const db = useDb();
  const stamp = `deleted-${userId.slice(0, 8)}-${Date.now()}@deleted.telroi.ai`;

  await db.update(schema.users)
    .set({ email: stamp, name: null })
    .where(eq(schema.users.id, userId));

  // Their handsets stop ringing. Deleted rather than revoked: a token is
  // personal data of a sort, it identifies a device somebody carries, and it is
  // of no use to the workspace once they have gone.
  await db.delete(schema.userDevices)
    .where(eq(schema.userDevices.userId, userId)).catch(() => {});
}

/**
 * Close a workspace along with its last member.
 *
 * Only when there is nobody to hand it to. A sole owner who cannot delete their
 * account and cannot transfer it has no way out from a phone, which is the
 * position a reviewer will be in with a fresh account — and the stores are
 * explicit that the route must exist in the app rather than by writing to us.
 */
export async function closeWorkspace(tenantId: string) {
  const db = useDb();
  // Marked rather than dropped. Numbers have to be released with the carrier,
  // recordings pruned from storage, and any balance accounted for — none of
  // which belongs in the seconds after somebody taps a button, and all of which
  // a nightly sweep can do properly.
  await db.update(schema.tenants)
    .set({ closedAt: new Date(), sandboxMode: true })
    .where(eq(schema.tenants.id, tenantId));
}
