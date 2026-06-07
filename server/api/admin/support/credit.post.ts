// POST /api/admin/support/credit { amountMinor } -> manually add float to the
// Telroi Support workspace wallet so support can place calls. Superadmin only.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { credit } from '~/server/utils/wallet';
import { randomToken } from '~/server/utils/crypto';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ amountMinor: z.number().int().positive() });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A positive amount (minor units) is required');

  const support = await ensureSupportWorkspace();
  const reference = `manual_${randomToken(10).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  const r = await credit(support.tenantId, p.data.amountMinor, 'manual_topup', reference, { by: admin.email, kind: 'support_float' });

  await logEvent({
    tenantId: support.tenantId, kind: 'system', action: 'support.credit',
    summary: `${admin.email} added float ${(p.data.amountMinor / 100).toFixed(2)} to support wallet`
  });
  return { ok: true, balanceMinor: r.balanceMinor };
});
