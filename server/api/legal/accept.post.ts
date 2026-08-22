// POST /api/legal/accept { documentId, inventoryId?, telnum?, categories[] }
//
// Records an acceptance. Everything the indemnity says is retained — who, their
// role, when, from where — is captured here rather than inferred later, because
// "the identity and authority evidence supporting it" cannot be reconstructed
// after the fact.
//
// Owner or admin only: the document requires acceptance by somebody authorised
// to bind the business, and that is the same set who can buy a number.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  documentId: z.string().uuid(),
  inventoryId: z.string().uuid().optional(),
  telnum: z.string().max(32).optional(),
  categories: z.array(z.string().max(32)).min(1)
});

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Could not record that acceptance');

  const db = useDb();
  const [doc] = await db.select().from(schema.legalDocuments)
    .where(eq(schema.legalDocuments.id, p.data.documentId)).limit(1);
  if (!doc) throw apiError('not_found', 'Unknown document', 404);

  // Only against the version in force. Accepting a superseded one would leave a
  // record that looks valid and is not.
  if (!doc.isCurrent) throw apiError('stale', 'That version has been replaced. Reload and read the current one.', 409);

  const [row] = await db.insert(schema.legalAcceptances).values({
    tenantId: s.tenantId,
    documentId: doc.id,
    inventoryId: p.data.inventoryId || null,
    telnum: p.data.telnum || null,
    userId: s.userId,
    userEmail: s.email,
    userRole: (s as any).role || null,
    declaredCategories: p.data.categories,
    ip: getRequestIP(event, { xForwardedFor: true }) || null,
    userAgent: (getHeader(event, 'user-agent') || '').slice(0, 300) || null
  }).returning({ id: schema.legalAcceptances.id });

  return { ok: true, acceptanceId: row.id, version: doc.version };
});
