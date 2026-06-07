<template>
  <div class="shell" :class="{ 'mobile-open': mobileOpen }">
    <AppSidebar :collapsed="collapsed" :mobile-open="mobileOpen" @toggle="onToggleSidebar" @close-mobile="mobileOpen = false" />
    <!-- Mobile drawer overlay -->
    <div class="shell-overlay" @click="mobileOpen = false"></div>
    <!-- White panel with curved top-left corner, inset on the cream background -->
    <div class="shell-panel">
      <AppTopbar @toggle-sidebar="onToggleSidebar" />
      <div class="shell-content">
        <div class="shell-inner">
          <slot />
        </div>
      </div>
    </div>
    <SetupTasks />
    <IdleLogout />
    <TourGuide />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useRoute, useRouter } from 'vue-router';
import { CLIENT_TOUR_ID, clientTour } from '~/composables/tourSteps';
const collapsed = ref(false);
const mobileOpen = ref(false);
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

// On mobile the hamburger opens/closes the slide-in drawer; on desktop it
// collapses the rail. We decide by viewport width at click time. On mobile we
// also force `collapsed` off so the drawer always shows the full nav + full
// logo (the collapsed rail is a desktop-only affordance).
function onToggleSidebar() {
  if (import.meta.client && window.innerWidth <= 820) {
    collapsed.value = false;
    mobileOpen.value = !mobileOpen.value;
  } else {
    collapsed.value = !collapsed.value;
  }
}
// Keep the collapsed flag from leaking onto mobile (e.g. resized from desktop).
function syncViewport() {
  if (import.meta.client && window.innerWidth <= 820) collapsed.value = false;
}
onMounted(() => {
  if (!import.meta.client) return;
  syncViewport();
  window.addEventListener('resize', syncViewport);
});
onUnmounted(() => {
  if (import.meta.client) window.removeEventListener('resize', syncViewport);
});
// Close the drawer whenever the route changes (tapping a nav link navigates).
watch(() => route.fullPath, () => { mobileOpen.value = false; });

// Telroi dogfoods its OWN Live Call widget for customer support, replacing
// Intercom. The signed-in client app fetches the active support widget key from
// the server at runtime (no env var needed) — so once an admin sets up the
// support workspace + Live Call, the widget appears for all clients automatically.
onMounted(async () => {
  if (!import.meta.client) return;
  try {
    const r = await $fetch<{ key: string | null }>('/api/support-widget');
    if (!r?.key) return;                       // no support workspace configured yet
    if (document.getElementById('telroi-livecall')) return; // already loaded
    const s = document.createElement('script');
    s.id = 'telroi-livecall';
    s.src = '/widget/v1.js';
    s.async = true;
    s.setAttribute('data-telroi-key', r.key);
    if (auth.user?.id) s.setAttribute('data-user-id', auth.user.id);
    if (auth.user?.email) s.setAttribute('data-user-name', auth.user.email);
    document.body.appendChild(s);
  } catch { /* support widget is optional */ }
});
// Auto-start the product tour for first-time users (only if unseen). Delayed so
// the sidebar + topbar anchors are mounted and laid out first.
onMounted(() => {
  if (!import.meta.client) return;
  const { startIfUnseen } = useTour();
  setTimeout(() => { startIfUnseen(CLIENT_TOUR_ID, clientTour, (r) => router.push(r)); }, 900);
});
</script>

<style scoped>
.shell { display: flex; min-height: 100vh; background: var(--paper-2); }
/* Mobile drawer overlay — hidden on desktop, shown when the drawer is open. */
.shell-overlay { display: none; }
@media (max-width: 820px) {
  .shell-overlay { position: fixed; inset: 0; z-index: 55; background: rgba(10,10,11,0.45); opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .shell.mobile-open .shell-overlay { opacity: 1; pointer-events: auto; }
  /* On mobile the panel takes the full width (sidebar is an overlay drawer). */
  .shell-panel { border-left: none; border-top-left-radius: 0; }
}
/* The main panel is white, sits on the cream shell, and curves its top-left
   corner away from the sidebar — the Column signature. A small top gap lets
   the corner round visibly. */
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
.shell-content { flex: 1; overflow-y: auto; }
.shell-inner { max-width: 1100px; margin: 0 auto; padding: 32px 40px 80px; }
@media (max-width: 820px) {
  .shell-panel { border-top-left-radius: 0; margin-top: 0; border-left: none; }
  .shell-inner { padding: 24px 20px 60px; }
}
</style>
