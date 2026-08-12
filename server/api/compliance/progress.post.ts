// POST /api/compliance/progress { officialName?, step? }
//
// Saves a half-finished compliance form. The NCC undertaking has to be printed,
// signed on company letterhead and scanned — days, not minutes — and losing a
// typed company name and a verified NIN to a closed tab is how somebody decides
// going live is more trouble than it is worth.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  officialName: z.string().max(200).optional(),
  step: z.number().int().min(0).max(6).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can submit compliance details.', 403);
  }
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Nothing to save');

  const db = useDb();
  const [existing] = await db.select().from(schema.compliance)
    .where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);

  const patch: any = {};
  if (p.data.officialName !== undefined) patch.officialName = p.data.officialName.trim();
  // Only forward. Reopening the modal and clicking back through it should not
  // tell us they have un-done work they have already finished.
  if (p.data.step !== undefined && p.data.step > (existing?.step || 0)) patch.step = p.data.step;
  if (!Object.keys(patch).length) return { ok: true };

  if (existing) {
    await db.update(schema.compliance).set(patch).where(eq(schema.compliance.id, existing.id));
  } else {
    // 'incomplete', not the pending default: a saved draft is not a submission,
    // and a row claiming otherwise would tell them their documents are under
    // review when they have uploaded none.
    await db.insert(schema.compliance).values({
      tenantId: s.tenantId, officialName: patch.officialName || '', status: 'incomplete', ...patch
    });
  }
  return { ok: true };
});
