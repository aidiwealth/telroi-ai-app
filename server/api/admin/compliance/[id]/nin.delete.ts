// DELETE /api/admin/compliance/:tenantId/nin — clear a director's NIN and its
// verification.
//
// Separate from deleting the submission, because the reasons differ. A NIN
// entered wrongly, belonging to the wrong director, or one a client has asked
// us to remove does not invalidate the licences they uploaded — and making them
// resubmit everything to correct one field is a poor answer.
//
// The number, the verification and the matched name all go together. Keeping
// ninName after removing the NIN would leave a citizen's name attached to a
// record with nothing to justify holding it, and the verified timestamp without
// the number it verified is a claim we could not evidence.
//
// ninAttempts is deliberately kept. It is the abuse counter — a lookup costs us
// money, and resetting it on every clear would let somebody retry indefinitely.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  // Named id because a sibling route already claimed that parameter name
  // on this path — Nitro cannot have :id and :tenantId on the same segment,
  // and having both meant one of them always arrived undefined. The value
  // is still a tenant id.
  const tenantId = getRouterParam(event, 'id') || '';
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenantId is required' });

  const db = useDb();
  const [row] = await db.select().from(schema.compliance)
    .where(eq(schema.compliance.tenantId, tenantId)).limit(1);
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No compliance record' });

  const patch: any = {
    nin: null, ninVerifiedAt: null, ninReference: null, ninName: null, directorName: null
  };
  // An approval that rested on a verified director no longer rests on anything.
  if (row.status === 'approved') { patch.status = 'pending'; patch.reviewedAt = null; }
  patch.notes = `${row.notes ? row.notes + '\n' : ''}${new Date().toISOString().slice(0, 10)} — director and NIN cleared by ${admin.email}`;

  await db.update(schema.compliance).set(patch)
    .where(eq(schema.compliance.tenantId, tenantId));
  return { ok: true, statusReset: row.status === 'approved' };
});
