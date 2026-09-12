// PUT /api/wallet/auto-topup
// Save the workspace's threshold/refill preference. This endpoint configures
// the feature only; the trigger worker is responsible for making a charge.
import { z } from 'zod';
import { requireTenantOwner, apiError } from '~/server/utils/api';
import {
  autoTopupResponse,
  getAutoTopupState,
  saveAutoTopupSettings
} from '~/server/utils/auto-topup';
import { logEvent } from '~/server/utils/logs';

const MAX_DATABASE_INTEGER = 2_147_483_647;
const Body = z.object({
  enabled: z.boolean(),
  consentAccepted: z.boolean().optional(),
  thresholdMinor: z.number().int().min(0).max(MAX_DATABASE_INTEGER),
  topupAmountMinor: z.number().int().positive().max(MAX_DATABASE_INTEGER)
}).strict();

export default defineEventHandler(async (event) => {
  const s = await requireTenantOwner(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError(
      'invalid',
      'enabled, thresholdMinor, and topupAmountMinor are required in minor currency units; consentAccepted must be a boolean when supplied.'
    );
  }

  const currency = await saveAutoTopupSettings(s.tenantId, parsed.data, {
    userId: s.userId,
    email: s.email
  });

  await logEvent({
    tenantId: s.tenantId,
    kind: 'system',
    action: parsed.data.enabled ? 'auto_topup.enabled' : 'auto_topup.configured',
    summary: parsed.data.enabled
      ? `Enabled below ${currency} ${(parsed.data.thresholdMinor / 100).toFixed(2)}; refill ${(parsed.data.topupAmountMinor / 100).toFixed(2)}`
      : 'Saved auto top-up settings while disabled'
  });

  return autoTopupResponse(await getAutoTopupState(s.tenantId));
});
