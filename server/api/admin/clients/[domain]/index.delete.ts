// DELETE /api/admin/clients/:domain { confirmSlug }
// Remove a workspace entirely. Every table that references a tenant cascades, so
// this takes their numbers, agents, call log, wallet and settings with it — there
// is no undo, which is why the guards below are deliberately unforgiving.
//
// Intended for test and abandoned sandbox workspaces. Anything with a history
// worth keeping should be left alone: a workspace that has taken real calls or
// holds money is a record, not clutter.
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ confirmSlug: z.string().min(1) });

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);

  const p = Body.safeParse(await readBody(event));
  if (!p.success || p.data.confirmSlug !== t.slug) {
    // Typing the slug is the point: it makes deleting the wrong workspace an act
    // rather than an accident.
    throw apiError('confirm_required', `Type the workspace's slug (${t.slug}) to confirm.`, 400);
  }

  if (t.isInternal) throw apiError('forbidden', 'The support workspace cannot be deleted.', 403);
  if (!t.sandboxMode) throw apiError('is_live', 'This workspace is live. Move it back to sandbox first.', 409);

  const db = useDb();

  const [{ calls }] = await db.select({ calls: sql<number>`count(*)::int` })
    .from(schema.callEvents).where(eq(schema.callEvents.tenantId, t.id));
  if (calls > 0) throw apiError('has_history', `This workspace has ${calls} call${calls === 1 ? '' : 's'} on record. Deleting it would take that history too.`, 409);

  const [{ numbers }] = await db.select({ numbers: sql<number>`count(*)::int` })
    .from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, t.id), ne(schema.numberSubscriptions.status, 'released')));
  if (numbers > 0) throw apiError('has_numbers', `This workspace still holds ${numbers} number${numbers === 1 ? '' : 's'}. Release them first so they return to inventory.`, 409);

  const [wallet] = await db.select({ balanceMinor: schema.wallets.balanceMinor })
    .from(schema.wallets).where(eq(schema.wallets.tenantId, t.id)).limit(1);
  if (wallet && wallet.balanceMinor !== 0) throw apiError('has_balance', 'This workspace has money in its wallet. Settle it before deleting.', 409);

  // Logged before the row goes, and without a tenant id — the log has to outlive
  // what it describes.
  await logEvent({
    tenantId: null, kind: 'system', action: 'workspace.deleted', level: 'warn',
    summary: `${admin.email} deleted workspace ${t.name} (${t.slug})`
  });

  await db.delete(schema.tenants).where(eq(schema.tenants.id, t.id));
  return { ok: true, deleted: { name: t.name, slug: t.slug } };
});
