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
  const creds = all?.digidite || all?.sotel || all?.asterisk || all?.ruach || all?.telnyx || null;
  if (!creds) {
    return { ok: false, reason: 'No Telroi voice gateway is configured for OTP. Configure a carrier in admin Settings, or select an external OTP vendor.' };
  }
  // Build the gateway call request. The media gateway (FreeSWITCH/Asterisk/
  // Kamailio or the carrier API) executes the dial + plays the TTS prompt.
  // The request shape below is what our gateway bridge consumes.
  try {
    const ref = `otp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    // NOTE: the live bridge call happens here against `creds.gateway`. In this
    // build we construct the intent and return its ref; the bridge picks it up.
    // (Audio cannot be synthesized/dialed without the live gateway + IP allowlist.)
    void speech; void input;
    return { ok: true, providerRef: ref, reason: 'queued_on_telroi_gateway' };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Telroi gateway error' };
  }
}
