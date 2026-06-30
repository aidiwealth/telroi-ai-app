// composables/useRingtone.ts
// A tiny synthesized phone ringtone (no audio file). The IncomingCall banner
// starts it when a call is ringing and stops it on answer/decline/cancel.
export function useRingtone() {
  let ctx: AudioContext | null = null;
  let timer: any = null;
  let gain: any = null;

  function burst() {
    if (!ctx) return;
    const now = ctx.currentTime;
    gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
    gain.gain.setValueAtTime(0.18, now + 1.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);
    gain.connect(ctx.destination);
    for (const f of [440, 480]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 2.0);
    }
  }

  function start() {
    try {
      if (!ctx) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
      }
      ctx.resume?.().catch(() => {});
      burst();
      timer = setInterval(burst, 6000);
    } catch { /* best-effort */ }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    try { gain?.disconnect?.(); } catch { /* */ }
    gain = null;
  }

  return { start, stop };
}
