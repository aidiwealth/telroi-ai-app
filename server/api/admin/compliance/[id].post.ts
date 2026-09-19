// POST /api/admin/compliance/:id { decision: 'approved'|'rejected', notes? }
// Operator review of a go-live request. Approval unlocks live mode for the tenant.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ decision: z.enum(['approved', 'rejected']), notes: z.string().max(280).optional() });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  // Staff decide these. They are the people reading the submissions daily, and
  // a queue that only a superadmin can clear is a queue that sits. The decision
  // is recorded against whoever made it, which is the accountability that
  // matters rather than the rank.

  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'decision required');
  const db = useDb();
  const [row] = await db.update(schema.compliance)
    .set({ status: p.data.decision, notes: p.data.notes || null, reviewedAt: new Date(), reviewedBy: admin.email })
    .where(eq(schema.compliance.id, id)).returning();
  // Said aloud as well as stored. Approving a submission decides whether a
  // workspace may place calls at all, and it is the record a regulator would
  // ask about — a decision with no author is the thing to avoid, not a decision
  // made by staff.
  console.log(`[compliance] ${p.data.decision} for ${id} by ${admin.email}`);
  if (!row) throw apiError('not_found', 'Submission not found', 404);

  // On approval, notify the workspace owner with a branded confirmation email.
  if (p.data.decision === 'approved') {
    try {
      const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, row.tenantId)).limit(1);
      const [owner] = await db.select({ email: schema.users.email })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(and(eq(schema.memberships.tenantId, row.tenantId), eq(schema.memberships.role, 'owner')))
        .limit(1);
      if (tenant && owner?.email) {
        const { sendComplianceApprovedEmail } = await import('~/server/utils/email');
        await sendComplianceApprovedEmail(owner.email, { workspace: tenant.name });
      }
    } catch (e) { console.error('[compliance] approval email failed', e); }
  }

  return { compliance: row };
});
