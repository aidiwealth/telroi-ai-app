// DELETE /api/admin/compliance/:tenantId/document?doc=business|regulatory|ncc
//
// Clears one uploaded document so the client can replace it. A wrong file, a
// scan nobody can read, or a licence that turns out to belong to a different
// company — without this the submission is stuck and the only remedy is a
// database edit.
//
// The object itself stays in R2. Removing the reference is what unblocks the
// client; destroying the file would mean a submission we approved could never
// be re-examined, and a regulator asking why is not the moment to discover it.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

const SLOTS = {
  business: ['businessLicenseKey', 'businessLicenseName', 'businessLicenseType'],
  regulatory: ['regulatoryLicenseKey', 'regulatoryLicenseName', 'regulatoryLicenseType'],
  ncc: ['nccUndertakingKey', 'nccUndertakingName', 'nccUndertakingType']
} as const;

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId') || '';
  const slot = String(getQuery(event).doc || '') as keyof typeof SLOTS;
  if (!tenantId || !SLOTS[slot]) {
    throw createError({ statusCode: 400, statusMessage: 'tenantId and a valid doc are required' });
  }

  const db = useDb();
  const [row] = await db.select().from(schema.compliance)
    .where(eq(schema.compliance.tenantId, tenantId)).limit(1);
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No compliance record' });

  const patch: any = {};
  for (const f of SLOTS[slot]) patch[f] = null;
  // Back to pending. A submission missing a document it had when it was
  // approved is not an approved submission, and leaving the status alone would
  // let a workspace keep an approval it no longer evidences.
  if (row.status === 'approved') { patch.status = 'pending'; patch.reviewedAt = null; }
  patch.notes = `${row.notes ? row.notes + '\n' : ''}${new Date().toISOString().slice(0, 10)} — ${slot} document cleared by ${admin.email}`;

  await db.update(schema.compliance).set(patch)
    .where(eq(schema.compliance.tenantId, tenantId));
  return { ok: true, slot, statusReset: row.status === 'approved' };
});
