// DELETE /api/admin/compliance/:tenantId — remove a submission so the client
// can start again.
//
// Clearing one document handles a wrong file. This is for a submission that is
// wrong throughout — the company named incorrectly, a form filled for the wrong
// entity, a client who asked to withdraw — where the remedy is to start over
// rather than patch.
//
// The row goes and the objects stay in R2. A submission we once approved has to
// remain re-examinable: a regulator asking why an account was verified is not
// the moment to find the evidence was deleted along with the form. The keys are
// written into the audit note so a stored object can still be found.
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

  // What was there, before it is not. Enough to find the stored objects and to
  // answer who removed what, without copying the NIN into a second place.
  console.log('[compliance] submission deleted', JSON.stringify({
    tenantId, by: admin.email, at: new Date().toISOString(),
    officialName: row.officialName, status: row.status,
    keys: [row.businessLicenseKey, row.regulatoryLicenseKey, row.nccUndertakingKey].filter(Boolean)
  }));

  await db.delete(schema.compliance).where(eq(schema.compliance.tenantId, tenantId));
  return { ok: true, deleted: true };
});
