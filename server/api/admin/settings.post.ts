// POST /api/admin/settings -> store platform credentials (encrypted). Superadmin only.
// Covers the single Digidite/operator credential, master carrier accounts, and
// payment-provider keys (live + test/sandbox per provider) plus the active mode.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';

const KeyPair = z.object({ live: z.string().optional(), test: z.string().optional() }).optional();
const MonnifyPair = z.object({
  live: z.object({ apiKey: z.string(), secretKey: z.string(), contractCode: z.string().optional() }).partial().optional(),
  test: z.object({ apiKey: z.string(), secretKey: z.string(), contractCode: z.string().optional() }).partial().optional()
}).optional();

const Body = z.object({
  // Single Digidite account (provisioning + default NG carrier)
  operatorDomain: z.string().min(3).optional(),
  operatorApiKey: z.string().min(8).optional(),
  operatorUsername: z.string().optional(),
  operatorPassword: z.string().optional(),
  operatorDialplanId: z.string().optional(),
  operatorRouteId: z.string().optional(),
  clientDomainSuffix: z.string().optional(),
  // Optional separate Digidite carrier override
  telroiPbxDomain: z.string().optional(),
  telroiPbxKey: z.string().optional(),
  // Other master carriers
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  telnyxApiKey: z.string().optional(),
  telnyxConnectionId: z.string().optional(),
  // Browser-voice (WebRTC) credentials for in-app + widget calling.
  twilioVoice: z.object({ apiKeySid: z.string(), apiKeySecret: z.string(), twimlAppSid: z.string(), callerId: z.string() }).partial().optional(),
  telnyxVoice: z.object({ sipUsername: z.string(), sipPassword: z.string(), connectionId: z.string(), callerId: z.string() }).partial().optional(),
  digiditeVoice: z.object({ wsServer: z.string(), sipDomain: z.string(), sipUsername: z.string(), sipPassword: z.string(), callerId: z.string() }).partial().optional(),
  asteriskVoice: z.object({ sipGateway: z.string(), sipPort: z.number(), transport: z.enum(['udp', 'tcp', 'tls']), sipDomain: z.string(), authUser: z.string(), authPass: z.string(), callerId: z.string(), dids: z.array(z.string()), apiBaseUrl: z.string(), apiUsername: z.string(), apiPassword: z.string(), ariAppName: z.string() }).partial().optional(),
  outboundSipIp: z.string().optional(),
  // Payment providers
  paymentMode: z.enum(['test', 'live']).optional(),
  otpChannel: z.enum(['resend', 'termii']).optional(),
  supportTelnum: z.string().optional(),
  supportNumbersByRegion: z.object({ NG: z.string().optional(), INTL: z.string().optional() }).partial().optional(),
  captchaEnabled: z.boolean().optional(),
  captchaProvider: z.enum(['turnstile', 'recaptcha']).optional(),
  captchaSiteKey: z.string().optional(),
  sipProxyDomain: z.string().optional(),
  docsDomain: z.string().optional(),
  statusDomain: z.string().optional(),
  stripe: KeyPair,
  paystack: KeyPair,
  monnify: MonnifyPair,
  // ── Voice OTP + Speech vendor selection + policy ──
  otpVoiceVendor: z.enum(['telroi', 'twilio', 'telnyx', 'vonage', 'custom']).optional(),
  ttsVendor: z.enum(['telroi', 'elevenlabs', 'openai', 'google', 'azure', 'custom']).optional(),
  sttVendor: z.enum(['telroi', 'deepgram', 'openai', 'google', 'azure', 'custom']).optional(),
  otpVoiceVendorCreds: z.record(z.any()).optional(),
  ttsVendorCreds: z.record(z.any()).optional(),
  sttVendorCreds: z.record(z.any()).optional(),
  otpPolicy: z.object({
    codeLength: z.number().int().min(4).max(10).optional(),
    ttlSeconds: z.number().int().min(30).max(1800).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    callTimeoutSeconds: z.number().int().min(10).max(120).optional(),
    repeatCount: z.number().int().min(1).max(5).optional(),
    rateMaxPerHour: z.number().int().min(1).max(100).optional(),
    rateMaxPerDay: z.number().int().min(1).max(1000).optional(),
    rateCooldownSeconds: z.number().int().min(0).max(3600).optional()
  }).partial().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid settings payload');
  const db = useDb();
  const d = p.data;

  const patch: any = { updatedAt: new Date() };
  if (d.operatorDomain) patch.operatorDomain = d.operatorDomain;
  if (d.clientDomainSuffix) patch.clientDomainSuffix = d.clientDomainSuffix;
  if (d.operatorApiKey) patch.operatorApiKeyEnc = encrypt(d.operatorApiKey);
  if (d.operatorUsername !== undefined) patch.operatorUsername = d.operatorUsername;
  if (d.operatorPassword) patch.operatorPasswordEnc = encrypt(d.operatorPassword);
  if (d.operatorDialplanId !== undefined) patch.operatorDialplanId = d.operatorDialplanId || null;
  if (d.operatorRouteId !== undefined) patch.operatorRouteId = d.operatorRouteId || null;
  if (d.telroiPbxDomain) patch.telroiPbxDomain = d.telroiPbxDomain;
  if (d.telroiPbxKey) patch.telroiPbxKeyEnc = encrypt(d.telroiPbxKey);
  if (d.twilioAccountSid && d.twilioAuthToken) patch.twilioCredsEnc = encrypt(JSON.stringify({ accountSid: d.twilioAccountSid, authToken: d.twilioAuthToken }));
  if (d.telnyxApiKey) patch.telnyxCredsEnc = encrypt(JSON.stringify({ apiKey: d.telnyxApiKey, connectionId: d.telnyxConnectionId || '' }));
  // Browser-voice creds: only store when all required fields for that provider
  // are present, so a partial save never half-configures voice.
  if (d.twilioVoice && d.twilioVoice.apiKeySid && d.twilioVoice.apiKeySecret && d.twilioVoice.twimlAppSid) {
    patch.twilioVoiceCredsEnc = encrypt(JSON.stringify({ apiKeySid: d.twilioVoice.apiKeySid, apiKeySecret: d.twilioVoice.apiKeySecret, twimlAppSid: d.twilioVoice.twimlAppSid, callerId: d.twilioVoice.callerId || '' }));
  }
  if (d.telnyxVoice && d.telnyxVoice.sipUsername && d.telnyxVoice.sipPassword) {
    patch.telnyxVoiceCredsEnc = encrypt(JSON.stringify({ sipUsername: d.telnyxVoice.sipUsername, sipPassword: d.telnyxVoice.sipPassword, connectionId: d.telnyxVoice.connectionId || '', callerId: d.telnyxVoice.callerId || '' }));
  }
  if (d.digiditeVoice && d.digiditeVoice.wsServer && d.digiditeVoice.sipUsername && d.digiditeVoice.sipPassword) {
    patch.digiditeVoiceCredsEnc = encrypt(JSON.stringify({ wsServer: d.digiditeVoice.wsServer, sipDomain: d.digiditeVoice.sipDomain || '', sipUsername: d.digiditeVoice.sipUsername, sipPassword: d.digiditeVoice.sipPassword, callerId: d.digiditeVoice.callerId || '' }));
  }
  // Sotel SIP trunk — IP-authenticated, so a gateway is enough (no user/pass required).
  // Merge over any existing creds so a blank password keeps the stored one.

  // Core Asterisk (global) — SIP trunk + AMI/ARI API. Preserve secrets when blank.
  if (d.asteriskVoice && d.asteriskVoice.sipGateway) {
    const { decrypt } = await import('~/server/utils/crypto');
    let ex: any = {};
    try { const cur = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1); if (cur[0]?.asteriskVoiceCredsEnc) ex = JSON.parse(decrypt(cur[0].asteriskVoiceCredsEnc)); } catch { /* */ }
    patch.asteriskVoiceCredsEnc = encrypt(JSON.stringify({
      sipGateway: d.asteriskVoice.sipGateway,
      sipPort: d.asteriskVoice.sipPort || 5060,
      transport: d.asteriskVoice.transport || 'udp',
      sipDomain: d.asteriskVoice.sipDomain || '',
      authUser: d.asteriskVoice.authUser || ex.authUser || '',
      authPass: d.asteriskVoice.authPass || ex.authPass || '',
      callerId: d.asteriskVoice.callerId || '',
      dids: d.asteriskVoice.dids || ex.dids || [],
      apiBaseUrl: d.asteriskVoice.apiBaseUrl || ex.apiBaseUrl || '',
      apiUsername: d.asteriskVoice.apiUsername || ex.apiUsername || '',
      apiPassword: d.asteriskVoice.apiPassword || ex.apiPassword || '',
      ariAppName: d.asteriskVoice.ariAppName || ex.ariAppName || ''
    }));
  }

  // Our outbound IP that vendors whitelist (admin override of the env default).
  if (d.outboundSipIp !== undefined) {
    patch.outboundSipIp = (d.outboundSipIp || '').trim() || null;
  }

  // Payment mode + keys. Only overwrite a slot when a non-empty value is sent,
  // so saving one field never wipes the others.
  if (d.paymentMode) patch.paymentMode = d.paymentMode;
  if (d.otpChannel) patch.otpChannel = d.otpChannel;
  if (d.supportTelnum !== undefined) patch.supportTelnum = d.supportTelnum || null;
  if (d.supportNumbersByRegion !== undefined) {
    patch.supportNumbersByRegion = d.supportNumbersByRegion;
    // Keep the legacy single field in sync with the NG number for back-compat.
    if (d.supportNumbersByRegion.NG !== undefined) patch.supportTelnum = d.supportNumbersByRegion.NG || null;
  }
  if (d.captchaEnabled !== undefined) patch.captchaEnabled = d.captchaEnabled;
  if (d.captchaProvider) patch.captchaProvider = d.captchaProvider;
  if (d.captchaSiteKey !== undefined) patch.captchaSiteKey = d.captchaSiteKey || null;
  if (d.sipProxyDomain !== undefined) patch.sipProxyDomain = d.sipProxyDomain || null;
  if (d.docsDomain !== undefined) patch.docsDomain = (d.docsDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
  if (d.statusDomain !== undefined) patch.statusDomain = (d.statusDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
  if (d.stripe?.live) patch.stripeLiveEnc = encrypt(d.stripe.live);
  if (d.stripe?.test) patch.stripeTestEnc = encrypt(d.stripe.test);
  if (d.paystack?.live) patch.paystackLiveEnc = encrypt(d.paystack.live);
  if (d.paystack?.test) patch.paystackTestEnc = encrypt(d.paystack.test);
  if (d.monnify?.live && d.monnify.live.apiKey && d.monnify.live.secretKey) patch.monnifyLiveEnc = encrypt(JSON.stringify(d.monnify.live));
  if (d.monnify?.test && d.monnify.test.apiKey && d.monnify.test.secretKey) patch.monnifyTestEnc = encrypt(JSON.stringify(d.monnify.test));
  // Voice OTP + Speech vendor selection
  if (d.otpVoiceVendor) patch.otpVoiceVendor = d.otpVoiceVendor;
  if (d.ttsVendor) patch.ttsVendor = d.ttsVendor;
  if (d.sttVendor) patch.sttVendor = d.sttVendor;
  if (d.otpVoiceVendorCreds && Object.keys(d.otpVoiceVendorCreds).length) patch.otpVoiceVendorCredsEnc = encrypt(JSON.stringify(d.otpVoiceVendorCreds));
  if (d.ttsVendorCreds && Object.keys(d.ttsVendorCreds).length) patch.ttsVendorCredsEnc = encrypt(JSON.stringify(d.ttsVendorCreds));
  if (d.sttVendorCreds && Object.keys(d.sttVendorCreds).length) patch.sttVendorCredsEnc = encrypt(JSON.stringify(d.sttVendorCreds));
  // OTP policy bounds
  if (d.otpPolicy) {
    const o = d.otpPolicy;
    if (o.codeLength != null) patch.otpCodeLength = o.codeLength;
    if (o.ttlSeconds != null) patch.otpTtlSeconds = o.ttlSeconds;
    if (o.maxAttempts != null) patch.otpMaxAttempts = o.maxAttempts;
    if (o.callTimeoutSeconds != null) patch.otpCallTimeoutSeconds = o.callTimeoutSeconds;
    if (o.repeatCount != null) patch.otpRepeatCount = o.repeatCount;
    if (o.rateMaxPerHour != null) patch.otpRateMaxPerHour = o.rateMaxPerHour;
    if (o.rateMaxPerDay != null) patch.otpRateMaxPerDay = o.rateMaxPerDay;
    if (o.rateCooldownSeconds != null) patch.otpRateCooldownSeconds = o.rateCooldownSeconds;
  }

  const [existing] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  if (existing) {
    await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, 'singleton'));
  } else {
    await db.insert(schema.platformSettings).values({ id: 'singleton', ...patch });
  }
  return { ok: true };
});
