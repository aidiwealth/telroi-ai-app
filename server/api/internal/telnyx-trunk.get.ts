// GET /api/internal/telnyx-trunk -> the SIP credentials for the outbound trunk.
//
// An operator registers to our own PBX because that is where a browser can be
// rung — a Telnyx registration can place a call but never receive one from us,
// and receiving is the whole point of a support desk. So calling internationally
// means a trunk from the PBX to Telnyx, and that trunk needs credentials.
//
// Served from here rather than copied onto the PBX: the encryption key belongs
// on the web app, and the PBX is the box most exposed to the world.
export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  if (!secret || getHeader(event, 'x-telroi-internal') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const { voiceCredentials } = await import('~/server/utils/voice-credentials');
  const creds: any = await voiceCredentials().catch(() => null);
  const t = creds?.telnyx;
  if (!t?.sipUsername || !t?.sipPassword) {
    throw createError({ statusCode: 404, statusMessage: 'Telnyx SIP credentials are not configured' });
  }

  return { sipUsername: t.sipUsername, sipPassword: t.sipPassword };
});
