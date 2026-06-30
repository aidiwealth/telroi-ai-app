// composables/useCallActive.ts
// Shared, app-wide flag: is there a live call (incoming ringing or connected)?
// IncomingCall sets it; IdleLogout reads it to avoid signing the user out
// mid-call (an active call IS activity, even with no mouse/keyboard input).
export function useCallActive() {
  return useState<boolean>('telroi-call-active', () => false);
}
