// POST /api/voice/token -> a browser-voice token for the signed-in tenant's
// assigned provider, so the dialer can place a real in-browser call.
import { requireTenant, apiError } from '~/server/utils/api';
import { voiceTokenFor } from '~/server/utils/voice-token';
import { resolveLiveCallProvider } from '~/server/utils/live-call-provider';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const body = await readBody<any>(event).catch(() => ({}));
  const selectedFrom = (body?.from || '').trim();
  // Use the tenant's default vendor, preferring the customer's SELECTED from-number
  // so routing follows the number the customer chose to call from.
  const dial = await resolveLiveCallProvider({ tenantId: s.tenantId, configuredProvider: 'auto', preferredFromNumber: selectedFrom || null });

  // Receiving and placing are different questions and were being given one answer.
  // Registering with the from-number's carrier meant our own PBX could never ring
  // a Twilio workspace, so escalations found nobody home; forcing everyone onto
  // the PBX then left those same workspaces unable to dial out, because their
  // outbound goes through Twilio's own SDK rather than an Asterisk trunk. So the
  // caller says which it wants: incoming always lands on our PBX, outgoing follows
  // whichever carrier owns the number being dialled from.
  const purpose = String(body?.purpose || 'receive');

  // A native client always registers on our PBX, whatever it is doing.
  //
  // The rule above — outgoing follows the number's carrier — exists because a
  // browser dials Twilio and Telnyx through their own SDKs, which a native app
  // does not have. It talks SIP, and our PBX already reaches every carrier over
  // its trunks: internal-route sends Nigerian numbers to whichever carrier owns
  // the caller's DID and everything else to Telnyx. So the app gets one path,
  // and a carrier added later needs no change in the app at all.
  const client = String(body?.client || 'browser');
  const registerOn = (client === 'native' || purpose !== 'dial') ? 'telroi' : dial.provider;
  if (registerOn === 'telroi') {
    try {
      // A browser gets the WebRTC endpoint, a native app gets one with plain
      // RTP over TLS. Offering DTLS-SRTP to a native SIP client returns 488
      // whatever codecs it has enabled, so they cannot share an endpoint.
      console.log('[token] ensuring endpoint', { client, purpose, tenantId: s.tenantId, userId: s.userId });
      const { ensureUserEndpoint } = await import('~/server/utils/provision-agent');
      const ensured = await ensureUserEndpoint(s.tenantId, s.userId, client === 'native' ? 'native' : 'browser');
      console.log('[token] endpoint ready', ensured);
    } catch (e: any) {
      throw apiError('voice_not_configured', e?.message || 'Browser calling could not be set up. Try again.', 503);
    }
  }
  // Resolve the from-number's BOUND vendor (set by admin in inventory) to a PBX
  // dial prefix, so browser calls route out the correct Asterisk trunk WITHOUT
  // the customer ever dealing with routes. ruach->81, kasooko->82, sotel->83,
  // twilio->84. Twilio was browser-only until now: the web dialler uses their
  // own SDK and never touches our PBX, so a phone had nowhere to route one.
  let dialPrefix = '';
  try {
    const lookupNum = selectedFrom || dial.fromNumber;
    if (lookupNum) {
      const { useDb, schema } = await import('~/server/db');
      const { and, eq } = await import('drizzle-orm');
      const db = useDb();
      const [sub] = await db.select().from(schema.numberSubscriptions)
        .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId), eq(schema.numberSubscriptions.telnum, lookupNum)))
        .limit(1);
      const raw = sub?.provider || '';
      dialPrefix = raw === 'ruach' ? '81' : raw === 'kasooko' ? '82' : raw === 'sotel' ? '83' : raw === 'twilio' ? '84' : '';
    }
  } catch { /* no prefix -> default routing */ }

  try {
    // The number the dialer selected is the caller ID — the user picked it.
    console.log('[token] fetching token', { registerOn, client });
    const tok = await voiceTokenFor(registerOn, `tenant_${s.tenantId}_${s.userId}`, dial.fromNumber, client === 'native' ? 'native' : 'browser');
    console.log('[token] got token', { provider: (tok as any)?.provider, sipUsername: (tok as any)?.sipUsername });
    return { ...tok, fromNumber: dial.fromNumber, providerReady: dial.ready, dialPrefix };
  } catch (e: any) {
    // Logged raw, before anything else touches it. If the error path itself
    // throws — building a response, reading config — the original is lost and
    // only a gateway 504 survives, which is what has hidden this all evening.
    console.error('[token] FAILED', e?.message, e?.stack);
    throw apiError('voice_not_configured', e?.message || 'Voice provider not configured', 503);
  }
});
