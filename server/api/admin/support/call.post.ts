// POST /api/admin/support/call { phone, clientTenantId? } -> support team places
// an outbound call to a client from the shared Telroi Support workspace.
// Mirrors the client click-to-call, but FROM the support workspace.
import { z } from 'zod';
import { requireSupportCaller } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { canAfford } from '~/server/utils/wallet';
import { telroiFor } from '~/server/utils/tenant';
import { placeCall } from '~/server/utils/call-router';
import { platformSettings } from '~/server/utils/platform';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({
  phone: z.string().min(3),
  clientTenantId: z.string().uuid().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requireSupportCaller(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A phone number is required');

  const support = await ensureSupportWorkspace();
  const settingsEarly = await platformSettings();
  const supMap = (settingsEarly?.supportNumbersByRegion || {}) as { NG?: string; INTL?: string };
  if (!(supMap.NG || supMap.INTL || settingsEarly?.supportTelnum)) {
    throw apiError('support_not_ready', 'No support caller-ID number is set. Choose a Nigeria and/or International support number in Settings → Telroi Support line, then try again.', 409);
  }

  if (!(await canAfford(support.tenantId, 1))) {
    throw apiError('insufficient_funds', 'The support workspace wallet is empty. Top it up to place calls.', 402);
  }

  const settings = settingsEarly;
  // Choose the support caller-ID by the DESTINATION's region so NG clients are
  // dialed from the NG support number and international clients from the intl one.
  const { supportNumberForCountry } = await import('~/server/utils/support-numbers');
  const { detectRegion } = await import('~/server/utils/regions');
  const destRegion = detectRegion(p.data.phone);
  const fromTelnum = (await supportNumberForCountry(destRegion === 'NG' ? 'Nigeria' : 'United States')) || settings?.supportTelnum || undefined;

  let result;
  if (fromTelnum) {
    result = await placeCall({ tenantId: support.tenantId, fromTelnum, to: p.data.phone });
  } else {
    const client = await telroiFor(support.tenantId);
    result = await client.makeCall({ phone: p.data.phone });
  }

  await logEvent({
    tenantId: p.data.clientTenantId || support.tenantId,
    kind: 'call', action: 'support.call',
    summary: `Support (${admin.email}) called ${p.data.phone}`
  });
  return { ok: true, ...result };
});
