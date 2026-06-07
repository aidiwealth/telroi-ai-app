// GET /api/admin/integrations -> which platform integrations are configured.
// Returns booleans only — never secret values. Reads resolved payment creds
// (admin-entered keys OR env fallback) so the status reflects reality.
import { requirePlatformAdmin, paymentCreds } from '~/server/utils/platform';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const cfg = useRuntimeConfig() as any;
  const pay = await paymentCreds();
  return {
    paymentMode: pay.mode,
    payments: {
      stripe: !!pay.stripe,
      paystack: !!pay.paystack,
      monnify: !!pay.monnify
    },
    email: { provider: cfg.emailProvider, resend: !!cfg.resendApiKey, termii: !!(cfg.termiiApiKey && cfg.termiiEmailConfigId) },
    storage: { backend: (cfg.r2AccountId && cfg.r2Bucket) ? 'r2' : 'local', bucket: cfg.r2Bucket || null },
    logs: { retentionDays: 60 }
  };
});
