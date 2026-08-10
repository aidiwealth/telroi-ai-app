// POST /api/compliance/verify-nin { nin, directorName }
//
// Verifies the person answering for the business before their documents can be
// submitted. Each lookup costs us money, so: a number already verified for this
// workspace returns from the record rather than the wire, and attempts are
// capped — somebody retyping a typo should not cost four lookups.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { verifyNin } from '~/server/utils/prembly';
import { logEvent } from '~/server/utils/logs';

const MAX_ATTEMPTS = 5;
const WINDOW_HOURS = 24;

const Body = z.object({
  nin: z.string().regex(/^[0-9]{11}$/, 'A NIN is 11 digits'),
  directorName: z.string().min(3, "Enter the director's full name as it appears on their NIN").max(120)
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can submit compliance details.', 403);
  }
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'A valid NIN and name are required');

  const db = useDb();
  const [row] = await db.select().from(schema.compliance)
    .where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);

  // Already done for this number. Returning the stored result costs nothing and
  // means a client revisiting the form isn't charged for a second look at the
  // same person.
  if (row?.ninVerifiedAt && row.nin === p.data.nin) {
    return { ok: true, verified: true, name: row.ninName, cached: true };
  }

  const since = row?.ninLastAttemptAt ? Date.now() - new Date(row.ninLastAttemptAt).getTime() : Infinity;
  const withinWindow = since < WINDOW_HOURS * 3600000;
  const attempts = withinWindow ? (row?.ninAttempts || 0) : 0;
  if (attempts >= MAX_ATTEMPTS) {
    throw apiError('rate_limited', `That's ${MAX_ATTEMPTS} attempts today. Contact support if the number is correct and still failing.`, 429);
  }

  const result = await verifyNin(p.data.nin, p.data.directorName);

  const patch: any = {
    directorName: p.data.directorName,
    ninAttempts: attempts + 1,
    ninLastAttemptAt: new Date()
  };

  if (!result.ok) {
    await saveCompliance(db, s.tenantId, patch);
    throw apiError('nin_failed', result.reason || 'We could not verify that NIN.', 422);
  }

  if (!result.matched) {
    // Deliberately vague about what NIMC holds: confirming or denying a name
    // against a number somebody has typed would make this a lookup service.
    await saveCompliance(db, s.tenantId, patch);
    throw apiError('name_mismatch', "That NIN is valid, but the name doesn't match what you entered. Check the spelling against the NIN itself.", 422);
  }

  patch.nin = p.data.nin;
  patch.ninVerifiedAt = new Date();
  patch.ninReference = result.reference || null;
  patch.ninName = result.name || null;
  await saveCompliance(db, s.tenantId, patch);

  await logEvent({
    tenantId: s.tenantId, kind: 'system', action: 'compliance.nin_verified',
    summary: `NIN verified for ${p.data.directorName}`
  });

  return { ok: true, verified: true, name: result.name };
});

/** The compliance row may not exist yet — the NIN is asked for before the
 *  documents, so this is often what creates it. */
async function saveCompliance(db: any, tenantId: string, patch: any) {
  const [existing] = await db.select().from(schema.compliance)
    .where(eq(schema.compliance.tenantId, tenantId)).limit(1);
  if (existing) {
    await db.update(schema.compliance).set(patch).where(eq(schema.compliance.id, existing.id));
  } else {
    await db.insert(schema.compliance).values({ tenantId, officialName: '', ...patch });
  }
}
