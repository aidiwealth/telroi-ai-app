// composables/usePlan.ts
// Fetches and caches the tenant's plan + feature entitlements for the session.
import { ref } from 'vue';

interface PlanState {
  plan: string;
  basePlan: string;
  planSelected: boolean;
  trial: { plan: string; endsAt: string; daysLeft: number } | null;
  trialDays: number;
  features: Record<string, boolean>;
}

const state = ref<PlanState | null>(null);
const loading = ref(false);

export function usePlan() {
  const api = useApi();

  async function load(force = false) {
    if (state.value && !force) return state.value;
    loading.value = true;
    try { state.value = await api.get<PlanState>('/api/plan'); }
    catch { state.value = null; }
    finally { loading.value = false; }
    return state.value;
  }

  function has(key: string): boolean {
    return !!state.value?.features?.[key];
  }

  return { state, loading, load, has };
}
