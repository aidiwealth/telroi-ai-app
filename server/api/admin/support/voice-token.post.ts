// POST /api/admin/support/voice-token -> browser-voice token for the support
// workspace using the admin-chosen provider (live_call callProvider setting).
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { effectiveSettings } from '~/server/utils/feature-settings';
import { resolveLiveCallProvider } from '~/server/utils/live-call-provider';
import { voiceTokenFor } from '~/server/utils/voice-token';
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const eff = await effectiveSettings(ws.tenantId, 'live_call');
  const dial = await resolveLiveCallProvider({ tenantId: ws.tenantId, configuredProvider: (eff.settings.callProvider as string) || 'auto' });
  try {
    const tok = await voiceTokenFor(dial.provider, `support_${(admin as any).id || 'agent'}`);
    return { ...tok, fromNumber: dial.fromNumber, providerReady: dial.ready };
  } catch (e: any) {
    throw apiError('voice_not_configured', e?.message || 'Voice provider not configured', 503);
  }
});
