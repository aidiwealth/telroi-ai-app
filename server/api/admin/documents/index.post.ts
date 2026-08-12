// POST /api/admin/documents (multipart) -> store a document clients download.
//
// The NCC undertaking and anything like it: a form a client prints, signs on
// their own letterhead and returns. Uploaded here rather than shipped with the
// code, because a regulator's form changes and a deploy is the wrong thing to
// need when it does.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { buildKey, putObject } from '~/server/utils/storage';
import { logEvent } from '~/server/utils/logs';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const parts = await readMultipartFormData(event).catch(() => null);
  if (!parts?.length) throw apiError('invalid', 'No file received');

  let slug = '', title = '', description = '', country = '';
  let file: { data: Buffer; filename: string; type: string } | null = null;

  for (const p of parts) {
    const v = () => (p.data?.toString('utf8') || '').trim();
    if (p.name === 'slug') { slug = v(); continue; }
    if (p.name === 'title') { title = v(); continue; }
    if (p.name === 'description') { description = v(); continue; }
    if (p.name === 'country') { country = v(); continue; }
    if (p.name === 'file' && p.filename) {
      const type = p.type || 'application/octet-stream';
      if (!ALLOWED.includes(type)) throw apiError('invalid', 'PDF, Word, PNG or JPG only');
      if (p.data.length > MAX_BYTES) throw apiError('invalid', 'That file is over 10MB');
      file = { data: p.data, filename: p.filename, type };
    }
  }

  if (!file) throw apiError('invalid', 'Choose a file to upload');
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) throw apiError('invalid', 'A slug is required: lowercase letters, numbers and underscores');
  if (!title) throw apiError('invalid', 'Give it a title clients will understand');

  const key = buildKey('platform-docs', 'platform', file.filename);
  await putObject(key, file.data, file.type);

  const db = useDb();
  const [existing] = await db.select().from(schema.platformDocuments)
    .where(eq(schema.platformDocuments.slug, slug)).limit(1);

  const values = {
    slug, title, description: description || null,
    objectKey: key, filename: file.filename, contentType: file.type,
    sizeBytes: file.data.length, country: country || null,
    uploadedBy: admin.email, updatedAt: new Date()
  };

  // Replacing rather than versioning: a client should always get the current
  // form, and keeping the old one only invites somebody signing the wrong page.
  if (existing) await db.update(schema.platformDocuments).set(values).where(eq(schema.platformDocuments.id, existing.id));
  else await db.insert(schema.platformDocuments).values(values);

  await logEvent({ kind: 'system', action: 'document.upload', summary: `${admin.email} uploaded "${title}" (${slug})` });
  return { ok: true, slug, title };
});
