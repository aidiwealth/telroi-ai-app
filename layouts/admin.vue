<template>
  <div class="shell" :class="{ 'mobile-open': mobileOpen }">
    <AdminSidebar :collapsed="collapsed" :mobile-open="mobileOpen" @toggle="onToggleSidebar" @logout="logout" />
    <div class="shell-overlay" @click="mobileOpen = false"></div>
    <div class="shell-panel">
      <div class="admin-topbar">
        <button class="admin-burger" @click="onToggleSidebar" aria-label="Toggle menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <span class="admin-tb-title">Operator console</span>
        <div class="admin-tb-right">
          <button class="admin-theme-btn" @click="startTour" title="Take a tour">◎ Tour</button>
          <button class="admin-theme-btn" @click="toggleDark" :title="dark ? 'Lights on' : 'Lights off'">
            {{ dark ? '☀ Lights on' : '☾ Lights off' }}
          </button>
          <span class="admin-email">{{ email }}</span>
        </div>
      </div>
      <div class="shell-content">
        <div class="shell-inner"><slot /></div>
      </div>
    </div>
    <CopilotDock api-base="/api/copilot/admin" />
    <!-- Support calls ring here: the browser registers against the support
         workspace so ring_all can reach whichever admins are online. -->
    <IncomingCall token-endpoint="/api/admin/support/voice-token" />
    <AdminTasks />
    <IdleLogout mode="admin" />
    <TourGuide />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ADMIN_TOUR_ID, adminTour } from '~/composables/tourSteps';
const collapsed = ref(false);
const mobileOpen = ref(false);
const email = ref('');
const route = useRoute();
const router = useRouter();
function startTour() { const { start } = useTour(); start(ADMIN_TOUR_ID, adminTour, (r) => router.push(r)); }
watch(() => route.fullPath, () => { mobileOpen.value = false; });
function syncViewport() {
  if (import.meta.client && window.innerWidth <= 820) collapsed.value = false;
}
// Mobile: open/close the drawer. Desktop: collapse the rail.
function onToggleSidebar() {
  if (import.meta.client && window.innerWidth <= 820) {
    collapsed.value = false;
    mobileOpen.value = !mobileOpen.value;
  } else {
    collapsed.value = !collapsed.value;
  }
}
onUnmounted(() => { if (import.meta.client) window.removeEventListener('resize', syncViewport); });

// Dark mode ("Lights off") — shares the same preference + class as the client
// side, so the theme is consistent across the whole product.
const dark = ref(false);
function toggleDark() {
  dark.value = !dark.value;
  if (import.meta.client) {
    document.documentElement.classList.toggle('dark', dark.value);
    localStorage.setItem('telroi_theme', dark.value ? 'dark' : 'light');
  }
}

onMounted(async () => {
  if (import.meta.client) {
    if (localStorage.getItem('telroi_theme') === 'dark') {
      dark.value = true;
      document.documentElement.classList.add('dark');
    }
    syncViewport();
    window.addEventListener('resize', syncViewport);
  }
  try { const r = await $fetch<{ admin: { email: string } }>('/api/admin/me'); email.value = r.admin.email; }
  catch { await navigateTo('/admin/login'); }
  if (import.meta.client) {
    const { startIfUnseen } = useTour();
    setTimeout(() => { startIfUnseen(ADMIN_TOUR_ID, adminTour, (r) => router.push(r)); }, 900);
  }
});
// Clears ONLY the admin cookie — any client session stays signed in.
async function logout() { await $fetch('/api/admin/logout', { method: 'POST' }); await navigateTo('/admin/login'); }
</script>

<style>
/* ── Shared admin page primitives (global, so every /admin page matches) ── */
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin: 4px 0 20px; line-height: 1.5; }
.ad-loading { color: var(--ink-mute); font-size: 14px; padding: 40px 0; }
.ad-section-title { font-family: var(--font-display); font-size: 20px; color: var(--ink); margin-bottom: 4px; }
/* Canonical admin table (matches Logs). Use: <div class="set-card ad-table-wrap"><table class="ad-data-table">… */
.ad-table-wrap { padding: 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.ad-data-table { width: 100%; border-collapse: collapse; }
.ad-data-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); font-weight: 500; padding: 12px 18px; border-bottom: 1px solid var(--rule); }
.ad-data-table td { padding: 11px 18px; border-bottom: 1px solid var(--rule-2); font-size: 13px; color: var(--ink); vertical-align: middle; }
.ad-data-table tr:last-child td { border-bottom: none; }
.ad-data-table .ad-r { text-align: right; }
.ad-dim { color: var(--ink-mute); }
</style>

<style scoped>
.shell { display: flex; min-height: 100vh; background: var(--paper-2); }
.shell-overlay { display: none; }
.admin-burger { display: none; color: var(--ink-soft); padding: 4px; margin-right: 4px; }
.admin-burger svg { width: 22px; height: 22px; }
@media (max-width: 820px) {
  .shell-overlay { position: fixed; inset: 0; z-index: 55; background: rgba(10,10,11,0.45); opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .shell.mobile-open .shell-overlay { opacity: 1; pointer-events: auto; }
  .admin-burger { display: inline-flex; align-items: center; }
}
.shell-panel {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  background: var(--paper);
  border-left: 1px solid var(--rule);
  border-top: 1px solid var(--rule);
  border-top-left-radius: 16px;
  margin-top: 10px;
  overflow: hidden;
  min-height: calc(100vh - 10px);
}
.admin-topbar {
  height: var(--topbar-h); flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 40px; border-bottom: 1px solid var(--rule);
}
.admin-tb-title { font-size: 14px; font-weight: 500; color: var(--ink); }
.admin-tb-right { display: flex; align-items: center; gap: 16px; }
.admin-theme-btn { font-size: 12.5px; color: var(--ink-soft); padding: 5px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--paper); transition: color 0.12s, border-color 0.12s; }
.admin-theme-btn:hover { color: var(--ink); border-color: var(--ink-soft); }
.admin-email { font-size: 13px; color: var(--ink-mute); }
.shell-content { flex: 1; overflow-y: auto; }
.shell-inner { max-width: 1100px; margin: 0 auto; padding: 32px 40px 80px; }
@media (max-width: 820px) {
  .shell-panel { border-top-left-radius: 0; margin-top: 0; border-left: none; }
  .shell-inner { padding: 24px 20px 60px; }
  .admin-topbar { padding: 0 20px; }
}
</style>
