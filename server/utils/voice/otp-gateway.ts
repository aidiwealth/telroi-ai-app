// server/utils/voice/otp-gateway.ts
// The 'telroi' OTP path: place the OTP-reading call through Telroi's OWN
// configured carrier gateway (the same voice infra resolved by
// live-call-provider / voiceCredentials). This is control-plane only — it
// builds and submits the call+TTS-prompt request to the gateway. The actual
// audio (dialing, playing the spoken code) runs on the live media bridge with
// real carrier credentials and a whitelisted IP.
import type { PlaceOtpCallInput, PlaceOtpCallResult } from './vendors';
import { voiceCredentials } from '../voice-credentials';

export async function resolveOtpGateway(input: PlaceOtpCallInput, speech: string): Promise<PlaceOtpCallResult> {
  // Telroi routes OTP voice over its default carrier gateway. We need the
  // gateway credentials to be configured; without them this honestly reports
  // that the service isn't available (rather than pretending a call placed).
  const all = await voiceCredentials().catch(() => null);
  const creds = all?.digidite || all?.asterisk || all?.telnyx || null;
  // Which trunk Nigerian OTP leaves on and what it presents are operator
  // settings, not constants — a carrier having a bad afternoon shouldn't need a
  // deploy to route around.
  const { platformSettings } = await import('../platform');
  const ps: any = await platformSettings().catch(() => ({}));
  if (!creds) {
    return { ok: false, reason: 'No Telroi voice gateway is configured for OTP. Configure a carrier in admin Settings, or select an external OTP vendor.' };
  }
  // Build the gateway call request. The media gateway (FreeSWITCH/Asterisk/
  // Kamailio or the carrier API) executes the dial + plays the TTS prompt.
  // The request shape below is what our gateway bridge consumes.
  try {
    // This used to build a reference, discard the code and the destination, and
    // report success — so every OTP was marked delivered and no phone rang. The
    // control app now dials through our own carrier and the dialplan reads the
    // digits from Asterisk's sound files, so the code never leaves the machine.
    void speech;
    // The same route and secret the SIP provisioning already uses — the control
    // app listens on localhost, so it's reachable only through the nginx proxy.
    const cfg = useRuntimeConfig() as any;
    const base = (cfg.provisionAgentUrl || '').replace(/\/+$/, '');
    const secret = cfg.provisionAgentSecret || '';
    if (!base || !secret) return { ok: false, reason: 'The PBX provisioning agent is not configured, so OTP calls cannot be placed.' };

    const res = await fetch(`${base}/otp-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        // So the hangup can be reported against this row rather than the call
        // simply ending unrecorded.
        otpId: input.otpId || null,
        to: input.toNumber,
        code: input.code,
        trunk: ps?.otpNgTrunk || 'ruach-endpoint',
        host: ps?.otpNgHost || cfg.otpHost || 'sip.ruach.ng',
        // Digits only. The settings dropdown offers numbers in E.164, and the
        // carrier's switch returned 500 on a caller id with a leading plus while
        // accepting the same number without one.
        callerId: String(ps?.otpNgCallerId || '').replace(/[^0-9]/g, ''),
        repeatCount: input.repeatCount,
        timeoutSec: input.callTimeoutSec
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return { ok: false, reason: `Gateway returned ${res.status}` };
    const d: any = await res.json().catch(() => ({}));
    if (!d?.ok) return { ok: false, reason: d?.error || 'Gateway refused the call' };
    return { ok: true, providerRef: d.callid || null };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Telroi gateway error' };
  }
}
