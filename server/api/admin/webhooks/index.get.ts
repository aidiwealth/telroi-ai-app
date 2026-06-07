// GET /api/admin/webhooks -> inbound webhook config: the URLs to paste into each
// carrier, which carriers are enabled, and whether signing secrets are set.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).limit(1);
  const base = (useRuntimeConfig().public as any).appBaseUrl || 'https://app.telroi.ai';
  return {
    urls: {
      twilio: `${base}/api/webhooks/twilio/voice`,
      telnyx: `${base}/api/webhooks/telnyx/voice`,
      pbx: `${base}/api/webhooks/pbx/voice`,
      sotel: `${base}/api/webhooks/sotel/voice`,
      asterisk: `${base}/api/webhooks/asterisk/voice`,
      ruach: `${base}/api/webhooks/ruach/voice`
    },
    enabled: (s?.inboundWebhooksEnabled as any) || {},
    secretsSet: {
      twilio: !!(s as any)?.twilioWebhookSecretEnc,   // optional; Twilio uses auth token
      telnyx: !!(s as any)?.telnyxWebhookSecretEnc,
      pbx: !!(s as any)?.pbxWebhookSecretEnc,
      sotel: !!(s as any)?.sotelWebhookSecretEnc,
      asterisk: !!(s as any)?.asteriskWebhookSecretEnc,
      ruach: !!(s as any)?.ruachWebhookSecretEnc
    }
  };
});
