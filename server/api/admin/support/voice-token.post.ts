// POST /api/admin/support/voice-token -> browser-voice token for the support
// workspace using the admin-chosen provider (live_call callProvider setting).
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { effectiveSettings } from '~/server/utils/feature-settings';
import { resolveLiveCallProvider } from '~/server/utils/live-call-provider';
import { voiceTokenFor } from '~/server/utils/voice-token';
export default defineEventHandler(async (event) => {
  console.log('[support-token] 1 start');
  const admin = await requirePlatformAdmin(event);
  console.log('[support-token] 2 admin ok');
  const ws = await ensureSupportWorkspace();
  console.log('[support-token] 3 workspace', ws.tenantId);
  // Support agents always register to our own PBX, whatever numbers the support
  // workspace happens to own. Registration decides where a browser can be RUNG,
  // and ring_all dials PBX endpoints — a Telnyx registration can place calls but
  // never receive one from us. Callers still arrive over whichever carrier suits
  // them; the PBX is where the two meet.
  const dial = await resolveLiveCallProvider({ tenantId: ws.tenantId, configuredProvider: 'telroi' });
  console.log('[support-token] 4 provider', dial.provider, dial.fromNumber, dial.ready);
  try {
    // asteriskVoiceToken reads the identity as tenant_<tenantId>_<userId> to find
    // this person's own endpoint — a bare 'support_x' left it looking up a tenant
    // that doesn't exist, so it never found the endpoint we made for them.
    const ident = `tenant_${ws.tenantId}_${(admin as any).id || 'agent'}`;
    console.log('[support-token] 4b calling voiceTokenFor', dial.provider, ident);
    const tok = await voiceTokenFor(dial.provider, ident);
    console.log('[support-token] 5 token ok');
    return { ...tok, fromNumber: dial.fromNumber, providerReady: dial.ready };
  } catch (e: any) {
    throw apiError('voice_not_configured', e?.message || 'Voice provider not configured', 503);
  }
});
