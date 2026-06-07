// server/utils/voice-credentials.ts
// Reads the browser-voice (WebRTC) credentials operators paste in admin settings.
import { decrypt } from './crypto';
import { platformSettings } from './platform';

export interface TwilioVoiceCreds { accountSid: string; apiKeySid: string; apiKeySecret: string; twimlAppSid: string; callerId: string; }
export interface TelnyxVoiceCreds { sipUsername: string; sipPassword: string; connectionId: string; callerId: string; }
export interface DigiditeVoiceCreds { wsServer: string; sipDomain: string; sipUsername: string; sipPassword: string; callerId: string; }
// Sotel direct SIP trunk (Nigeria). IP-authenticated: a fixed signaling gateway
// (IP or domain) + transport, optional auth, caller id and the assigned DIDs.
export interface SotelSipCreds {
  sipGateway: string;          // e.g. "96.0.46.249"
  sipPort: number;             // e.g. 5060
  transport: 'udp' | 'tcp' | 'tls';
  sipDomain?: string;          // SIP domain if different from the gateway IP
  authUser?: string;           // optional — blank when the trunk is IP-authenticated
  authPass?: string;
  callerId?: string;           // default outbound caller id (one of the DIDs)
  dids: string[];              // assigned numbers on this trunk
}
// Core Asterisk (global). SIP trunk + AMI/ARI REST API, IP-authenticated.
export interface AsteriskVoiceCreds {
  sipGateway: string;          // Asterisk server IP/host
  sipPort: number;             // e.g. 5060
  transport: 'udp' | 'tcp' | 'tls';
  sipDomain?: string;
  authUser?: string;           // optional — blank when IP-authenticated
  authPass?: string;
  callerId?: string;
  dids: string[];
  apiBaseUrl?: string;         // ARI base, e.g. https://asterisk.example.com:8088/ari
  apiUsername?: string;        // ARI/AMI user
  apiPassword?: string;        // ARI/AMI secret
  ariAppName?: string;         // Stasis app name for ARI origination
}
// Ruach SIP trunk (Nigeria only). Account-number + password against sip.ruach.ng.
export interface RuachVoiceCreds {
  sipAccount: string;          // SIP account number (login)
  sipPassword: string;
  sipDomain: string;           // fixed: sip.ruach.ng
  callerId?: string;
  dids: string[];
}

export async function voiceCredentials() {
  const s = await platformSettings();
  if (!s) return { twilio: null, telnyx: null, digidite: null, sotel: null, asterisk: null, ruach: null };
  const twilioBase = s.twilioCredsEnc ? JSON.parse(decrypt(s.twilioCredsEnc)) : null;
  const tv = s.twilioVoiceCredsEnc ? JSON.parse(decrypt(s.twilioVoiceCredsEnc)) : null;
  return {
    twilio: tv ? ({ accountSid: twilioBase?.accountSid, ...tv } as TwilioVoiceCreds) : null,
    telnyx: s.telnyxVoiceCredsEnc ? (JSON.parse(decrypt(s.telnyxVoiceCredsEnc)) as TelnyxVoiceCreds) : null,
    digidite: s.digiditeVoiceCredsEnc ? (JSON.parse(decrypt(s.digiditeVoiceCredsEnc)) as DigiditeVoiceCreds) : null,
    sotel: s.sotelVoiceCredsEnc ? (JSON.parse(decrypt(s.sotelVoiceCredsEnc)) as SotelSipCreds) : null,
    asterisk: s.asteriskVoiceCredsEnc ? (JSON.parse(decrypt(s.asteriskVoiceCredsEnc)) as AsteriskVoiceCreds) : null,
    ruach: s.ruachVoiceCredsEnc ? (JSON.parse(decrypt(s.ruachVoiceCredsEnc)) as RuachVoiceCreds) : null
  };
}

// Our outbound/signaling IP that SIP vendors must whitelist. Admin override wins,
// else the env default. Displayed (read-only) on each vendor card in settings.
export async function outboundSipIp(): Promise<string> {
  try {
    const s = await platformSettings();
    if (s?.outboundSipIp) return s.outboundSipIp;
  } catch { /* */ }
  return process.env.OUTBOUND_SIP_IP || '';
}
