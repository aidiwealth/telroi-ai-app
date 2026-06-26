// composables/useVoiceCall.ts
// Real in-browser calling. Loads the provider's WebRTC SDK, requests the
// microphone (this is what triggers the browser mic prompt), registers with a
// server-issued token/credential, and connects a call with live two-way audio.
// Supports Twilio Voice, Telnyx WebRTC, and Telroi Voice / Asterisk (SIP.js over WebSocket).
import { ref } from 'vue';

type CallState = 'idle' | 'acquiring_mic' | 'connecting' | 'ringing' | 'in_call' | 'ended' | 'error';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

export function useVoiceCall() {
  const state = ref<CallState>('idle');
  const error = ref<string | null>(null);
  const callId = ref<string | null>(null);
  const startedAt = ref<number>(0);
  let device: any = null;       // Twilio Device
  let activeConn: any = null;   // Twilio Connection / Telnyx call / SIP session
  let telnyxClient: any = null;
  let sipUA: any = null;
  let provider = '';
  let mediaStream: MediaStream | null = null;

  // Ask for the mic up front so the user sees the prompt immediately.
  async function ensureMic() {
    state.value = 'acquiring_mic';
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return mediaStream;
  }

  // Fetch a token from the given endpoint (client dialer or admin support).
  async function getToken(tokenEndpoint: string) {
    const r = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('Could not get a voice token. Provider may not be configured.');
    return await r.json();
  }

  async function startCall(opts: { to: string; tokenEndpoint: string; onEnd?: (secs: number) => void }) {
    error.value = null;
    try {
      await ensureMic();                       // mic prompt
      const tok = await getToken(opts.tokenEndpoint);
      provider = tok.provider;
      state.value = 'connecting';

      if (provider === 'twilio') {
        await loadScript('https://sdk.twilio.com/js/voice/releases/2.11.0/twilio.min.js');
        const Twilio = (window as any).Twilio;
        device = new Twilio.Device(tok.token, { codecPreferences: ['opus', 'pcmu'] });
        await device.register();
        activeConn = await device.connect({ params: { To: opts.to, CallerId: tok.callerId || '' } });
        activeConn.on('ringing', () => { state.value = 'ringing'; });
        activeConn.on('accept', () => { state.value = 'in_call'; startedAt.value = Date.now(); });
        activeConn.on('disconnect', () => endCall(opts.onEnd));
        activeConn.on('error', (e: any) => { error.value = e?.message || 'Call error'; state.value = 'error'; });
      } else if (provider === 'telnyx') {
        await loadScript('https://unpkg.com/@telnyx/webrtc@2.22.0/lib/bundle.js');
        const TelnyxRTC = (window as any).TelnyxRTC?.TelnyxRTC || (window as any).TelnyxRTC;
        telnyxClient = new TelnyxRTC({ login: tok.login, password: tok.password });
        telnyxClient.on('telnyx.ready', () => {
          activeConn = telnyxClient.newCall({ destinationNumber: opts.to, callerNumber: tok.callerId, audio: true, video: false });
          state.value = 'ringing';
        });
        telnyxClient.on('telnyx.notification', (n: any) => {
          const st = n?.call?.state;
          if (st === 'active') { state.value = 'in_call'; if (!startedAt.value) startedAt.value = Date.now(); }
          if (st === 'hangup' || st === 'destroy') endCall(opts.onEnd);
        });
        telnyxClient.connect();
      } else if (provider === 'digidite' || provider === 'telroi' || provider === 'asterisk') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/sip.js/0.21.2/sip.min.js');
        const SIP = (window as any).SIP;
        const uri = SIP.UserAgent.makeURI(`sip:${tok.sipUsername}@${tok.sipDomain}`);
        sipUA = new SIP.UserAgent({
          uri, transportOptions: { server: tok.wsServer },
          authorizationUsername: tok.sipUsername, authorizationPassword: tok.sipPassword
        });
        await sipUA.start();
        const target = SIP.UserAgent.makeURI(`sip:${opts.to}@${tok.sipDomain}`);
        const inviter = new SIP.Inviter(sipUA, target, { sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
        activeConn = inviter;
        inviter.stateChange.addListener((st: string) => {
          if (st === 'Establishing') state.value = 'ringing';
          if (st === 'Established') { state.value = 'in_call'; startedAt.value = Date.now(); attachSipAudio(inviter); }
          if (st === 'Terminated') endCall(opts.onEnd);
        });
        await inviter.invite();
      } else {
        throw new Error(`The configured voice provider (${provider}) is a SIP trunk and can't run directly in the browser. Set the support workspace to a browser-capable provider (Twilio, Telnyx, or Digidite) in Settings, or route takeover audio through your media bridge.`);
      }
    } catch (e: any) {
      error.value = e?.message || 'Could not start the call';
      state.value = 'error';
      cleanup();
    }
  }

  function attachSipAudio(session: any) {
    try {
      const pc = session.sessionDescriptionHandler?.peerConnection;
      if (!pc) return;
      const remote = new MediaStream();
      pc.getReceivers().forEach((r: any) => { if (r.track) remote.addTrack(r.track); });
      let audio = document.getElementById('telroi-remote-audio') as HTMLAudioElement;
      if (!audio) { audio = document.createElement('audio'); audio.id = 'telroi-remote-audio'; audio.autoplay = true; document.body.appendChild(audio); }
      audio.srcObject = remote;
    } catch { /* */ }
  }

  function hangup() { endCall(); }

  function endCall(onEnd?: (secs: number) => void) {
    const secs = startedAt.value ? Math.round((Date.now() - startedAt.value) / 1000) : 0;
    try {
      if (provider === 'twilio' && activeConn) activeConn.disconnect?.();
      if (provider === 'telnyx' && activeConn) activeConn.hangup?.();
      if ((provider === 'digidite' || provider === 'telroi' || provider === 'asterisk') && activeConn) { activeConn.bye?.().catch(() => {}); activeConn.cancel?.().catch(() => {}); }
    } catch { /* */ }
    state.value = 'ended';
    cleanup();
    if (onEnd) onEnd(secs);
  }

  function cleanup() {
    try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { device?.destroy?.(); } catch { /* */ }
    try { telnyxClient?.disconnect?.(); } catch { /* */ }
    try { sipUA?.stop?.(); } catch { /* */ }
    mediaStream = null; device = null; activeConn = null; telnyxClient = null; sipUA = null;
  }

  return { state, error, callId, startCall, hangup };
}
