<template>
  <aside class="sidebar" :class="{ collapsed, 'mobile-open': mobileOpen }">
    <div class="sb-head">
      <NuxtLink to="/admin" class="sb-brand">
        <img v-if="!collapsed" src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" />
        <img v-else src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-v1%20logo.png" alt="Telroi" class="mark" />
      </NuxtLink>
      <button class="sb-collapse" @click="$emit('toggle')" :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'" :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      </button>
    </div>

    <div v-if="!collapsed" class="sb-opbadge">Operator</div>

    <nav class="sb-nav">
      <NuxtLink v-for="item in visibleItems" :key="item.to" :to="item.to" class="sb-link" :title="item.label" :data-tour="item.tour" :class="{ exact: isActive(item.to) }">
        <span class="sb-icon" v-html="item.icon" />
        <span v-if="!collapsed" class="sb-label">{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <div class="sb-footer">
      <button class="sb-link" title="Sign out" @click="$emit('logout')">
        <span class="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
        <span v-if="!collapsed" class="sb-label">Sign out</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
defineProps<{ collapsed: boolean; mobileOpen?: boolean }>();
defineEmits<{ toggle: []; logout: [] }>();
const route = useRoute();

// Operator role — restricted nav items (App releases, Settings, Pricing, Audit)
// are hidden from staff. Server endpoints also enforce this, so this is purely UX.
const role = ref<string>('');
const visibleItems = computed(() => items.filter((it: any) => !it.superadminOnly || role.value === 'superadmin'));
onMounted(async () => {
  try { const r = await $fetch<any>('/api/admin/me'); role.value = r?.admin?.role || ''; } catch { /* */ }
});
// Exact match for /admin, prefix match for the rest (so detail pages keep the parent active).
function isActive(to: string) {
  if (to === '/admin') return route.path === '/admin';
  return route.path.startsWith(to);
}

const items = [
  { label: 'Overview', to: '/admin', tour: 'nav-admin-overview', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="10" rx="1.6"/><rect x="13" y="3" width="8" height="6" rx="1.6"/><rect x="3" y="15" width="8" height="6" rx="1.6"/><rect x="13" y="11" width="8" height="10" rx="1.6"/></svg>' },
  { label: 'Clients', to: '/admin/clients', tour: 'nav-admin-clients', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" opacity="0.75"/></svg>' },
  { label: 'Live Call', to: '/admin/support', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 16 0"/><rect x="2.5" y="12" width="4" height="6" rx="1.5"/><rect x="17.5" y="12" width="4" height="6" rx="1.5"/><path d="M20 18a4 4 0 0 1-4 3.5h-2"/></svg>' },
  { label: 'CRM', to: '/admin/crm', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 8.5h5M18 6v5" opacity="0.75"/></svg>' },
  { label: 'AI Numbers', to: '/admin/vans', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h10"/></svg>' },
  { label: 'Numbers', to: '/admin/inventory', tour: 'nav-admin-inventory', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L8 21M16 3l-2 18"/><path d="M4 8.5h16M3 15.5h16"/></svg>' },
  { label: 'Compliance', to: '/admin/compliance', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l7.5 3v6c0 5-3.5 8.5-7.5 10-4-1.5-7.5-5-7.5-10v-6z"/><path d="M9 12l2 2 4-4.5"/></svg>' },
  { label: 'Blocked numbers', to: '/admin/blacklist', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>' },
  { label: 'Pricing', to: '/admin/pricing', tour: 'nav-admin-pricing', superadminOnly: true, icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2.5" x2="12" y2="21.5"/><path d="M16.5 6H9.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H7"/></svg>' },
  { label: 'Plans', to: '/admin/plans', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5h17M3.5 12h17M3.5 16.5h11"/><circle cx="18.5" cy="16.5" r="2.2" opacity="0.7"/></svg>' },
  { label: 'Logs', to: '/admin/logs', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/><path d="M8.5 13h7M8.5 16.5h7M8.5 9.5h2"/></svg>' },
  { label: 'Finance', to: '/admin/finance', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5h18M3 7.5v11a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5v-11M3 7.5 6 4h12l3 3.5"/><circle cx="12" cy="13.5" r="2.5"/></svg>' },
  { label: 'Team', to: '/admin/team', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" opacity="0.75"/></svg>' },
  { label: 'App releases', to: '/admin/apps', tour: 'nav-admin-apps', superadminOnly: true, icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/></svg>' },
  { label: 'Status', to: '/admin/status', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg>' },
  { label: 'Settings', to: '/admin/settings', tour: 'nav-admin-settings', superadminOnly: true, icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' }
];
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-w); flex-shrink: 0;
  background: var(--paper-2);
  display: flex; flex-direction: column; height: 100vh;
  position: sticky; top: 0; transition: width 0.2s var(--motion-ease);
}
.sidebar.collapsed { width: 68px; }
.sb-head { display: flex; align-items: center; justify-content: space-between; height: var(--topbar-h); padding: 18px 16px 18px 20px; }
.sb-brand { display: flex; align-items: center; flex: 1; min-width: 0; }
.sb-brand img { height: 26px; }
.sb-brand img.mark { height: 24px; }
.sidebar.collapsed .sb-head { height: auto; padding: 18px 0; flex-direction: column; gap: 12px; justify-content: flex-start; align-items: center; }
.sidebar.collapsed .sb-brand { flex: none; justify-content: center; width: 100%; }
.sidebar.collapsed .sb-nav { padding: 10px 0; align-items: center; }
.sidebar.collapsed .sb-footer { padding: 8px 0; align-items: center; }
.sidebar.collapsed .sb-link { width: 44px; padding: 10px 0; justify-content: center; gap: 0; }
.sb-opbadge {
  margin: 0 20px 8px; align-self: flex-start;
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--signal); border: 1px solid var(--signal-soft); background: var(--signal-soft); padding: 2px 8px; border-radius: 999px;
}
.sb-nav { flex: 1; padding: 10px 12px; display: flex; flex-direction: column; gap: 1px; overflow-y: auto; }
.sb-link {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 9px 12px; border-radius: var(--radius-sm);
  color: var(--ink-soft); font-size: 14px; font-weight: 500;
  transition: background 0.12s, color 0.12s; text-align: left;
}
.sb-link:hover { background: var(--paper-3); color: var(--ink); }
.sb-link.exact { background: var(--signal-soft); color: var(--signal); }
.sb-icon { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; }
.sb-icon :deep(svg) { width: 20px; height: 20px; }
.sb-label { white-space: nowrap; flex: 1; }
.sb-footer { padding: 8px 12px; border-top: 1px solid var(--rule-2); display: flex; flex-direction: column; gap: 1px; }
.sb-collapse { padding: 6px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: var(--ink-mute); transition: background 0.14s, color 0.14s; width: 30px; height: 30px; flex-shrink: 0; }
.sb-collapse:hover { background: var(--paper-3); color: var(--ink); }
.sb-collapse svg { width: 18px; height: 18px; }
@media (max-width: 820px) {
  .sidebar { position: fixed; top: 0; left: 0; z-index: 60; height: 100vh; width: 270px; box-shadow: var(--shadow-pop); transform: translateX(-100%); transition: transform 0.24s var(--motion-ease); }
  .sidebar.mobile-open { transform: translateX(0); }
  /* Drawer is always the full nav — neutralize the desktop collapsed rail. */
  .sidebar.collapsed { width: 270px; }
  .sidebar.collapsed .sb-head { height: var(--topbar-h); padding: 18px 16px 18px 20px; flex-direction: row; gap: 0; justify-content: space-between; align-items: center; }
  .sidebar.collapsed .sb-brand { flex: 1; justify-content: flex-start; width: auto; }
  .sidebar.collapsed .sb-nav { padding: 10px 12px; align-items: stretch; }
  .sidebar.collapsed .sb-footer { padding: 8px 12px; align-items: stretch; }
  .sidebar.collapsed .sb-link { width: 100%; padding: 9px 12px; justify-content: flex-start; gap: 12px; }
  .sidebar.collapsed .sb-brand img.mark { display: none; }
}
</style>
