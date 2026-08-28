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
  const body = await readBody<any>(event).catch(() => ({}));
  const client = String(body?.client || 'browser');
  // Which support number to call from. An operator on the road picks one the
  // way the client dialler does; without it the provider resolves whichever it
  // considers default, which is right for the console and arbitrary on a phone.
  const from = String(body?.from || '').trim();
  const ws = await ensureSupportWorkspace();
  // Support agents always register to our own PBX, whatever numbers the support
  // workspace happens to own. Registration decides where a browser can be RUNG,
  // and ring_all dials PBX endpoints — a Telnyx registration can place calls but
  // never receive one from us. Callers still arrive over whichever carrier suits
  // them; the PBX is where the two meet.
  const dial = await resolveLiveCallProvider({
    tenantId: ws.tenantId, configuredProvider: 'telroi',
    preferredFromNumber: from || null
  });

  // Make sure this operator actually has an endpoint. The client token endpoint
  // does this and the support one didn't, so an operator could open the console,
  // get a token and still have nothing to ring — four of five had no endpoint at
  // all, and none of them could be added to a department.
  // Declared outside the block that sets it: the token below needs the same id
  // the endpoint was provisioned against, and a const scoped to the try would
  // throw when read here — silently, inside a catch.
  let uid: string | null = null;

  try {
    const { ensureUserEndpoint } = await import('~/server/utils/provision-agent');
    // The operator's users id, not their platform admin id. meta.userId is
    // named for a user and every consumer treats it as one — the department
    // cache, the membership check — so storing an admin id here is the fault
    // those places were working around. Each console session was also minting a
    // fresh endpoint under the wrong id, so a corrected row was immediately
    // joined by a new broken one.
    const { userIdForAdmin } = await import('~/server/utils/platform');
    uid = await userIdForAdmin(String((admin as any).id));
    if (!uid) throw apiError('no_user', 'Could not identify you as a user to attach a phone to.', 500);
    // The endpoint of the kind being asked for. Provisioning the browser's and
    // then handing back a native token would leave the app registering to an
    // endpoint that offers DTLS, which is the 488 again.
    await ensureUserEndpoint(ws.tenantId, uid, client === 'native' ? 'native' : 'browser');
  } catch (e: any) {
    throw apiError('voice_not_configured', e?.message || 'Browser calling could not be set up. Try again.', 503);
  }

  try {
    // asteriskVoiceToken reads the identity as tenant_<tenantId>_<userId> to find
    // this person's own endpoint — a bare 'support_x' left it looking up a tenant
    // that doesn't exist, so it never found the endpoint we made for them.
    // The same id the endpoint was provisioned against. Changing provisioning
    // to the users id without changing this left the token asking for an
    // endpoint that does not exist — so no operator has registered since, and a
    // department resolved its member correctly and rang nobody.
    const ident = `tenant_${ws.tenantId}_${uid}`;
    // A native client needs its own endpoint: plain RTP over TLS rather than the
    // browser's DTLS, or it refuses the offer with 488. This endpoint was
    // written before that existed and asked for whatever the browser gets.
    const tok = await voiceTokenFor(dial.provider, ident, dial.fromNumber,
      client === 'native' ? 'native' : 'browser');
    return { ...tok, fromNumber: dial.fromNumber, providerReady: dial.ready };
  } catch (e: any) {
    throw apiError('voice_not_configured', e?.message || 'Voice provider not configured', 503);
  }
});
