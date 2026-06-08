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
    sotelVoiceSet: !!s?.sotelVoiceCredsEnc,
    // Non-secret Sotel trunk values for the form to pre-fill (auth password omitted).
    sotelVoice: (() => {
      if (!s?.sotelVoiceCredsEnc) return null;
      try {
        const v = JSON.parse(decrypt(s.sotelVoiceCredsEnc));
        return { sipGateway: v.sipGateway, sipPort: v.sipPort, transport: v.transport, sipDomain: v.sipDomain, authUser: v.authUser, callerId: v.callerId, dids: v.dids || [] };
      } catch { return null; }
    })(),
    asteriskVoiceSet: !!s?.asteriskVoiceCredsEnc,
    asteriskVoice: (() => {
      if (!s?.asteriskVoiceCredsEnc) return null;
      try {
        const v = JSON.parse(decrypt(s.asteriskVoiceCredsEnc));
        // Secrets (authPass, apiPassword) omitted from the response.
        return { sipGateway: v.sipGateway, sipPort: v.sipPort, transport: v.transport, sipDomain: v.sipDomain, authUser: v.authUser, callerId: v.callerId, dids: v.dids || [], apiBaseUrl: v.apiBaseUrl, apiUsername: v.apiUsername, ariAppName: v.ariAppName };
      } catch { return null; }
    })(),
    ruachVoiceSet: !!s?.ruachVoiceCredsEnc,
    ruachVoice: (() => {
      if (!s?.ruachVoiceCredsEnc) return null;
      try {
        const v = JSON.parse(decrypt(s.ruachVoiceCredsEnc));
        // sipPassword omitted.
        return { sipAccount: v.sipAccount, sipDomain: v.sipDomain, callerId: v.callerId, dids: v.dids || [] };
      } catch { return null; }
    })(),
    // Our outbound IP for vendors to whitelist (admin override, else env default).
    outboundSipIp: s?.outboundSipIp || process.env.OUTBOUND_SIP_IP || '',
    // Payment provider state (booleans only) + active mode
    paymentMode: (s?.paymentMode as 'test' | 'live') || 'test',
    otpChannel: (s?.otpChannel as 'resend' | 'termii') || 'resend',
    supportTelnum: s?.supportTelnum || null,
    supportNumbersByRegion: s?.supportNumbersByRegion || {},
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
