// DELETE /api/auth/account
//
// Both app stores require an account can be deleted from inside the app, and
// they are explicit that a link to a web page or an email to support does not
// count. So this has to work from a phone, for the person a reviewer will be:
// a fresh sign-up who is the sole owner of their own workspace.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { workspaceStanding, anonymiseUser, closeWorkspace } from '~/server/utils/account-deletion';
import { clearSession } from '~/server/utils/session';
import { logEvent } from '~/server/utils/logs';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  // Typed back when a workspace closes with them. Not security — they are
  // already signed in — but a moment's friction in front of the one action
  // that cannot be taken back.
  confirmWorkspaceName: z.string().optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event).catch(() => ({})));
  const standing = await workspaceStanding(s.tenantId, s.userId);
  const db = useDb();

  // An owner with colleagues cannot simply leave: the workspace holds their
  // numbers, their money and their call history, and orphaning it would be a
  // worse outcome than asking for one more step.
  if (standing.isOwner && standing.others > 0) {
    throw apiError('transfer_first',
      'Make somebody else an owner first, or remove the other members. A workspace cannot be left without one.',
      409);
  }

  const closes = standing.isOwner && standing.others === 0;
  if (closes) {
    const [tenant] = await db.select({ name: schema.tenants.name })
      .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
    const typed = (p.success && p.data.confirmWorkspaceName || '').trim();
    if (!typed || typed !== (tenant?.name || '').trim()) {
      throw apiError('confirm_name',
        'Type the workspace name to confirm. This closes the workspace as well as your account.',
        400);
    }
  }

  await logEvent({
    tenantId: s.tenantId, kind: 'audit', action: 'account.deleted',
    summary: closes
      ? 'Account deleted and workspace closed by its last member'
      : 'Account deleted'
  }).catch(() => { /* the deletion matters more than the note of it */ });

  await anonymiseUser(s.userId);
  if (closes) await closeWorkspace(s.tenantId);
  await clearSession(event).catch(() => {});

  return { ok: true, closedWorkspace: closes };
});
