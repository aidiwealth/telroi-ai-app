// composables/useTour.ts
// Drives the guided product tour. A tour is a list of steps; each step points at
// a [data-tour="key"] anchor in the DOM and carries copy. The engine handles
// active state, navigation, and "seen" persistence (so it doesn't nag). The
// visual layer lives in <TourGuide>; this just holds the brain.
import { ref, computed } from 'vue';

export interface TourStep {
  target?: string;        // data-tour key to spotlight; omit for a centered intro/outro card
  title: string;
  body: string;
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
  route?: string;         // navigate here before showing this step (for multi-page tours)
}

const active = ref(false);
const stepIndex = ref(0);
const steps = ref<TourStep[]>([]);
const tourId = ref<string>('');
const onNavigate = ref<((route: string) => void) | null>(null);

const SEEN_PREFIX = 'telroi_tour_seen_';

export function useTour() {
  const current = computed<TourStep | null>(() => steps.value[stepIndex.value] || null);
  const total = computed(() => steps.value.length);
  const isFirst = computed(() => stepIndex.value === 0);
  const isLast = computed(() => stepIndex.value === steps.value.length - 1);

  function hasSeen(id: string): boolean {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(SEEN_PREFIX + id) === '1'; } catch { return false; }
  }
  function markSeen(id: string) {
    try { localStorage.setItem(SEEN_PREFIX + id, '1'); } catch { /* */ }
  }

  // Start a tour. `navigate` lets multi-page tours change route between steps.
  function start(id: string, tourSteps: TourStep[], navigate?: (route: string) => void) {
    tourId.value = id;
    steps.value = tourSteps;
    stepIndex.value = 0;
    onNavigate.value = navigate || null;
    active.value = true;
    maybeNavigate();
  }
  // Auto-start only if the user hasn't seen it (used on first login).
  function startIfUnseen(id: string, tourSteps: TourStep[], navigate?: (route: string) => void) {
    if (hasSeen(id)) return false;
    start(id, tourSteps, navigate);
    return true;
  }
  function maybeNavigate() {
    const r = current.value?.route;
    if (r && onNavigate.value) onNavigate.value(r);
  }
  function next() {
    if (isLast.value) return finish();
    stepIndex.value++;
    maybeNavigate();
  }
  function prev() {
    if (isFirst.value) return;
    stepIndex.value--;
    maybeNavigate();
  }
  function goTo(i: number) {
    if (i < 0 || i >= steps.value.length) return;
    stepIndex.value = i;
    maybeNavigate();
  }
  function finish() {
    if (tourId.value) markSeen(tourId.value);
    active.value = false;
    steps.value = [];
    stepIndex.value = 0;
  }
  function skip() { finish(); }

  return { active, stepIndex, steps, current, total, isFirst, isLast, start, startIfUnseen, next, prev, goTo, finish, skip, hasSeen, markSeen };
}
