// POST /api/admin/legal/seed
//
// Loads a versioned legal document from the repo into the database, once. The
// text lives in server/legal/ so it is reviewable in a pull request like any
// other change, and in the database so an acceptance can point at the exact
// wording somebody saw.
//
// Idempotent: a version already present is left alone rather than rewritten —
// editing the text of a version somebody has accepted would destroy the thing
// the record exists to prove.
import { and, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const KNOWN: Record<string, { file: string; title: string; version: string }> = {
  number_indemnity: {
    file: 'server/legal/number-indemnity-1.0.md',
    title: 'Telroi Number Use Indemnity',
    version: '1.0'
  }
};

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const { slug } = await readBody<{ slug: string }>(event);
  const spec = KNOWN[slug];
  if (!spec) throw apiError('unknown', `No document named ${slug}`, 400);

  const db = useDb();
  const [existing] = await db.select().from(schema.legalDocuments)
    .where(and(eq(schema.legalDocuments.slug, slug), eq(schema.legalDocuments.version, spec.version)))
    .limit(1);
  if (existing) return { ok: true, alreadyPresent: true, id: existing.id, version: existing.version };

  const body = await readFile(spec.file, 'utf8').catch(() => null);
  if (!body) throw apiError('missing_file', `${spec.file} is not readable`, 500);

  // One current version per slug, enforced by a partial unique index — so the
  // previous one is stood down before the new one is raised.
  await db.update(schema.legalDocuments).set({ isCurrent: false })
    .where(eq(schema.legalDocuments.slug, slug));

  const [row] = await db.insert(schema.legalDocuments).values({
    slug, version: spec.version, title: spec.title, body, isCurrent: true
  }).returning();

  return { ok: true, id: row.id, version: row.version, chars: body.length };
});
