// POST /api/payment-method { provider, token, brand?, last4?, expMonth?, expYear? }
// Saves a card-on-file. The card was tokenized CLIENT-SIDE by the provider SDK
// (Stripe Elements / Paystack) — we only ever receive and store the token plus
// display-safe metadata. We NEVER receive or store raw card numbers.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({
  provider: z.enum(['stripe', 'paystack']),
  token: z.string().min(3),
  brand: z.string().optional(),
  last4: z.string().regex(/^\d{2,4}$/).optional(),
  expMonth: z.number().int().min(1).max(12).optional(),
  expYear: z.number().int().min(2024).max(2099).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A tokenized card is required');
  const db = useDb();

  // Replace any prior default card (one card-on-file per tenant for now).
  await db.delete(schema.paymentMethods).where(eq(schema.paymentMethods.tenantId, s.tenantId));
  const [pm] = await db.insert(schema.paymentMethods).values({
    tenantId: s.tenantId, provider: p.data.provider, token: p.data.token,
    brand: p.data.brand, last4: p.data.last4, expMonth: p.data.expMonth, expYear: p.data.expYear, isDefault: true
  }).returning();

  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'card.saved', summary: `Card on file: ${p.data.brand || 'card'} ****${p.data.last4 || ''}` });
  return { card: { brand: pm.brand, last4: pm.last4, expMonth: pm.expMonth, expYear: pm.expYear, provider: pm.provider } };
});
