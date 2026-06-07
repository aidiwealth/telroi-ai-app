// POST /api/admin/email-templates { overrides?, social? } -> save admin edits to
// email copy and footer social links. Superadmin only. Overrides are merged so
// a partial save (one template) doesn't wipe the rest.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const FieldSet = z.object({
  subject: z.string().max(200).optional(),
  heading: z.string().max(200).optional(),
  intro: z.string().max(2000).optional(),
  body: z.string().max(2000).optional()
}).strict();

const Body = z.object({
  overrides: z.record(z.string(), FieldSet).optional(),
  social: z.object({
    x: z.string().max(300).optional(),
    linkedin: z.string().max(300).optional(),
    instagram: z.string().max(300).optional(),
    facebook: z.string().max(300).optional()
  }).optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid template payload');

  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).limit(1);
  const current = (s?.emailOverrides as any) || {};
  const mergedOverrides = { ...current, ...(p.data.overrides || {}) };
  const mergedSocial = { ...((s?.emailSocial as any) || {}), ...(p.data.social || {}) };

  const patch: any = { emailOverrides: mergedOverrides, emailSocial: mergedSocial };
  if (s) await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, s.id));
  else await db.insert(schema.platformSettings).values({ id: 'singleton', ...patch });

  return { ok: true, overrides: mergedOverrides, social: mergedSocial };
});
