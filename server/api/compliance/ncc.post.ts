// POST /api/compliance/ncc (multipart) -> the signed NCC undertaking.
//
// Uploaded on its own rather than with the licences, because this one takes
// days: printed, signed on the company's own letterhead, scanned. Holding it
// hostage to the rest of the form would mean re-uploading everything each time
// they came back to it.
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { buildKey, putObject } from '~/server/utils/storage';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can submit compliance details.', 403);
  }

  const parts = await readMultipartFormData(event).catch(() => null);
  const file = parts?.find((p) => p.name === 'undertaking' && p.filename);
  if (!file) throw apiError('invalid', 'Choose your signed undertaking to upload');

  const type = file.type || 'application/octet-stream';
  if (!ALLOWED.includes(type)) throw apiError('invalid', 'PDF, PNG or JPG only');
  if (file.data.length > MAX_BYTES) throw apiError('invalid', 'That file is over 10MB');

  const key = buildKey('compliance-ncc', s.tenantId, file.filename!);
  await putObject(key, file.data, type);

  const db = useDb();
  const [existing] = await db.select().from(schema.compliance)
    .where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);

  const patch = {
    nccUndertakingKey: key,
    nccUndertakingName: file.filename!,
    nccUndertakingType: type
  };

  if (existing) await db.update(schema.compliance).set(patch).where(eq(schema.compliance.id, existing.id));
  else await db.insert(schema.compliance).values({ tenantId: s.tenantId, officialName: '', status: 'incomplete', ...patch });

  return { ok: true, filename: file.filename };
});
