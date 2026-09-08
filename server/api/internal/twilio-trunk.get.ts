// GET /api/internal/twilio-trunk -> the SIP credentials for the outbound trunk.
//
// Twilio has been a second calling path rather than a carrier: the browser
// dialler uses Twilio's own Voice SDK and talks to their cloud directly, never
// touching our PBX. A native app speaks SIP to our PBX and has nowhere to route
// a Twilio number, so those numbers worked in a browser and not on a phone.
//
// This is the trunk that closes that gap. Served from here rather than copied
// onto the PBX, for the same reason as Telnyx: the encryption key belongs on
// the web app, and the PBX is the box most exposed to the world.
export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  if (!secret || getHeader(event, 'x-telroi-internal') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const { voiceCredentials } = await import('~/server/utils/voice-credentials');
  const creds: any = await voiceCredentials().catch(() => null);
  const t = creds?.twilio;
  if (!t?.sipUsername || !t?.sipPassword) {
    // Not an error: a platform may run the browser path alone, and the trunk
    // builder treats this as "no international route" rather than a failure.
    return { configured: false };
  }
  return {
    configured: true,
    sipUsername: t.sipUsername,
    sipPassword: t.sipPassword,
    // The generic hostname routes to Twilio's nearest edge and survives one
    // going down, where a pinned region does not.
    sipDomain: t.sipDomain || 'telroi.pstn.twilio.com'
  };
});
