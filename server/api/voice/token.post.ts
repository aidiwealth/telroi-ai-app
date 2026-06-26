// POST /api/voice/token -> a browser-voice token for the signed-in tenant's
// assigned provider, so the dialer can place a real in-browser call.
import { requireTenant, apiError } from '~/server/utils/api';
import { voiceTokenFor } from '~/server/utils/voice-token';
import { resolveLiveCallProvider } from '~/server/utils/live-call-provider';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  // Use the tenant's default vendor (country-based / number carrier).
  const dial = await resolveLiveCallProvider({ tenantId: s.tenantId, configuredProvider: 'auto' });
  if (dial.provider === 'telroi') {
    try {
      const { ensureWebrtcEndpoint } = await import('~/server/utils/provision-agent');
      await ensureWebrtcEndpoint(s.tenantId);
    } catch (e: any) {
      throw apiError('voice_not_configured', e?.message || 'Browser calling could not be set up. Try again.', 503);
    }
  }
  try {
    const tok = await voiceTokenFor(dial.provider, `tenant_${s.tenantId}_${s.userId}`);
    return { ...tok, fromNumber: dial.fromNumber, providerReady: dial.ready };
  } catch (e: any) {
    throw apiError('voice_not_configured', e?.message || 'Voice provider not configured', 503);
  }
});
