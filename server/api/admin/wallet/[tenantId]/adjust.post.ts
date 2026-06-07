// POST /api/admin/wallet/:tenantId/adjust { direction: 'credit'|'debit', amountMinor, reason }
// Operator manual wallet adjustment (refund, goodwill credit, correction).
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { credit, debit } from '~/server/utils/wallet';

const Body = z.object({
  direction: z.enum(['credit', 'debit']),
  amountMinor: z.number().int().positive(),
  reason: z.string().min(2).max(140)
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'direction, amountMinor and reason required');

  const ref = `admin_${p.data.direction}_${tenantId}_${Date.now()}`;
  const meta = { adminAdjustment: true, by: admin.email, note: p.data.reason };

  if (p.data.direction === 'credit') {
    await credit(tenantId, p.data.amountMinor, `admin_credit:${p.data.reason}`, ref, meta);
  } else {
    await debit({ tenantId, amountMinor: p.data.amountMinor, reason: `admin_debit:${p.data.reason}`, reference: ref, meta });
  }
  return { ok: true };
});
