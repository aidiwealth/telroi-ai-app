// The sub-account the dashboard is currently "viewing as", or null for the whole
// workspace. Persisted in a cookie so it survives navigation and reloads, and
// read by data fetches to scope what they request.
import { ref } from 'vue';
const _id = ref<string | null>(null);
const _name = ref<string | null>(null);
let _init = false;

export function useActiveSubAccount() {
  if (!_init && import.meta.client) {
    _init = true;
    try {
      const raw = document.cookie.split('; ').find((c) => c.startsWith('tlr_sa='));
      if (raw) { const v = JSON.parse(decodeURIComponent(raw.split('=')[1] || '')); _id.value = v.id || null; _name.value = v.name || null; }
    } catch { /* ignore */ }
  }
  function set(id: string | null, name: string | null) {
    _id.value = id; _name.value = name;
    if (import.meta.client) {
      const val = id ? encodeURIComponent(JSON.stringify({ id, name })) : '';
      document.cookie = `tlr_sa=${val}; path=/; max-age=${id ? 60 * 60 * 24 * 30 : 0}`;
    }
  }
  // Append ?sub_account_id= to a query object when scoped.
  function scope(q: Record<string, any> = {}) { return _id.value ? { ...q, sub_account_id: _id.value } : q; }
  return { id: _id, name: _name, set, scope };
}
