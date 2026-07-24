// GET /api/admin/settings -> platform config (operator domain, masked key state)
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  return {
    operatorDomain: s?.operatorDomain || '',
    clientDomainSuffix: s?.clientDomainSuffix || 'digitaltide.io',
    operatorKeySet: !!s?.operatorApiKeyEnc,
    operatorUsername: s?.operatorUsername || '',
    operatorPasswordSet: !!s?.operatorPasswordEnc,
    operatorDialplanId: s?.operatorDialplanId || '',
    operatorRouteId: s?.operatorRouteId || '',
    // Master carrier config state (booleans only — never return secrets)
    telroiPbxDomain: s?.telroiPbxDomain || '',
    telroiPbxKeySet: !!s?.telroiPbxKeyEnc,
    twilioSet: !!s?.twilioCredsEnc,
    telnyxSet: !!s?.telnyxCredsEnc,
    twilioVoiceSet: !!s?.twilioVoiceCredsEnc,
    telnyxVoiceSet: !!s?.telnyxVoiceCredsEnc,
    digiditeVoiceSet: !!s?.digiditeVoiceCredsEnc,
    // Non-secret WebRTC values so the cards show what's configured. A blank field
    // should mean "not set" — returning only a boolean made a configured card look
    // empty, so operators re-entered details that were already there.
    telnyxVoice: (() => {
      if (!s?.telnyxVoiceCredsEnc) return null;
      try {
        const v = JSON.parse(decrypt(s.telnyxVoiceCredsEnc));
        // sipPassword omitted — the card shows "· set" for it instead.
        return { sipUsername: v.sipUsername, connectionId: v.connectionId, callerId: v.callerId };
      } catch { return null; }
    })(),
    twilioVoice: (() => {
      if (!s?.twilioVoiceCredsEnc) return null;
      try {
        const v = JSON.parse(decrypt(s.twilioVoiceCredsEnc));
        // apiKeySecret omitted.
        return { apiKeySid: v.apiKeySid, twimlAppSid: v.twimlAppSid, callerId: v.callerId };
      } catch { return null; }
    })(),
    // Non-secret Sotel trunk values for the form to pre-fill (auth password omitted).
    asteriskVoiceSet: !!s?.asteriskVoiceCredsEnc,
    asteriskVoice: (() => {
      if (!s?.asteriskVoiceCredsEnc) return null;
      try {
        const v = JSON.parse(decrypt(s.asteriskVoiceCredsEnc));
        // Secrets (authPass, apiPassword) omitted from the response.
        return { sipGateway: v.sipGateway, sipPort: v.sipPort, transport: v.transport, sipDomain: v.sipDomain, authUser: v.authUser, callerId: v.callerId, dids: v.dids || [], apiBaseUrl: v.apiBaseUrl, apiUsername: v.apiUsername, ariAppName: v.ariAppName };
      } catch { return null; }
    })(),
    // Our outbound IP for vendors to whitelist (admin override, else env default).
    outboundSipIp: s?.outboundSipIp || process.env.OUTBOUND_SIP_IP || '',
    // Payment provider state (booleans only) + active mode
    paymentMode: (s?.paymentMode as 'test' | 'live') || 'test',
    otpChannel: (s?.otpChannel as 'resend' | 'termii') || 'resend',
    supportTelnum: s?.supportTelnum || null,
    supportNumbersByRegion: s?.supportNumbersByRegion || {},
    // Sandbox allowances for new workspaces (per-client overrides live on the
    // client page). Fall back to the same defaults the resolver uses.
    sandboxCallCap: s?.sandboxCallCap ?? 20,
    sandboxAgentCap: s?.sandboxAgentCap ?? 1,
    captchaEnabled: !!s?.captchaEnabled,
    captchaProvider: (s?.captchaProvider as string) || 'turnstile',
    captchaSiteKey: s?.captchaSiteKey || '',
    sipProxyDomain: s?.sipProxyDomain || '',
    docsDomain: s?.docsDomain || '',
    statusDomain: s?.statusDomain || '',
    // Voice OTP + Speech vendor selection (vendor names + creds-set booleans, never secrets)
    otpVoiceVendor: (s?.otpVoiceVendor as string) || 'telroi',
    ttsVendor: (s?.ttsVendor as string) || 'telroi',
    sttVendor: (s?.sttVendor as string) || 'telroi',
    otpVoiceVendorCredsSet: !!s?.otpVoiceVendorCredsEnc,
    ttsVendorCredsSet: !!s?.ttsVendorCredsEnc,
    sttVendorCredsSet: !!s?.sttVendorCredsEnc,
    otpPolicy: {
      codeLength: s?.otpCodeLength ?? 6,
      ttlSeconds: s?.otpTtlSeconds ?? 300,
      maxAttempts: s?.otpMaxAttempts ?? 3,
      callTimeoutSeconds: s?.otpCallTimeoutSeconds ?? 45,
      repeatCount: s?.otpRepeatCount ?? 2,
      rateMaxPerHour: s?.otpRateMaxPerHour ?? 5,
      rateMaxPerDay: s?.otpRateMaxPerDay ?? 20,
      rateCooldownSeconds: s?.otpRateCooldownSeconds ?? 60
    },
    captchaSecretSet: !!(useRuntimeConfig() as any).captchaSecret,
    stripeLiveSet: !!s?.stripeLiveEnc,
    stripeTestSet: !!s?.stripeTestEnc,
    paystackLiveSet: !!s?.paystackLiveEnc,
    paystackTestSet: !!s?.paystackTestEnc,
    monnifyLiveSet: !!s?.monnifyLiveEnc,
    monnifyTestSet: !!s?.monnifyTestEnc
  };
});
