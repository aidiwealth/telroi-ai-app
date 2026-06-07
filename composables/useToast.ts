import { ref } from 'vue';
interface Toast { id: number; msg: string; kind: 'ok' | 'err' | 'info'; }
const toasts = ref<Toast[]>([]);
let seq = 0;
export function useToast() {
  function push(msg: string, kind: Toast['kind'] = 'info') {
    const id = ++seq;
    toasts.value.push({ id, msg, kind });
    setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 3800);
  }
  return {
    toasts,
    ok: (m: string) => push(m, 'ok'),
    err: (m: string) => push(m, 'err'),
    info: (m: string) => push(m, 'info')
  };
}
