<template>
  <aside class="sidebar" :class="{ collapsed, 'mobile-open': mobileOpen }">
    <div class="sb-head">
      <NuxtLink to="/" class="sb-brand">
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

    <nav class="sb-nav">
      <template v-for="section in sections" :key="section.label">
        <!-- Standalone top-level link (no children) -->
        <NuxtLink
          v-if="!section.children"
          :to="section.to"
          class="sb-link"
          :title="section.label"
          :data-tour="section.tour"
        >
          <span class="sb-icon" v-html="section.icon" />
          <span v-if="!collapsed" class="sb-label">{{ section.label }}</span>
        </NuxtLink>

        <!-- Collapsible section with children -->
        <div v-else class="sb-section">
          <button class="sb-section-head" @click="toggle(section.label)" :title="section.label" :data-tour="section.tour">
            <span class="sb-icon" v-html="section.icon" />
            <template v-if="!collapsed">
              <span class="sb-label">{{ section.label }}</span>
              <span class="sb-caret" :class="{ open: isOpen(section) }">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </template>
          </button>
          <Transition name="sb-expand">
            <div v-show="!collapsed && isOpen(section)" class="sb-children">
              <NuxtLink v-for="c in section.children" :key="c.to" :to="c.to" class="sb-child">{{ c.label }}</NuxtLink>
            </div>
          </Transition>
        </div>
      </template>
    </nav>

    <!-- Pinned footer: docs + help (Column-style) -->
    <div class="sb-footer">
      <a href="/api/docs" target="_blank" class="sb-link" title="API Documentation">
        <span class="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2 2 0 0 1 6 4h5v15.5H6a2 2 0 0 0-2 1.5z"/><path d="M20 5.5A2 2 0 0 0 18 4h-5v15.5h5a2 2 0 0 1 2 1.5z"/><path d="M7.5 8h2M7.5 11h2M14.5 8h2M14.5 11h2"/></svg></span>
        <span v-if="!collapsed" class="sb-label">Documentation</span>
      </a>
      <NuxtLink to="/developers" class="sb-link" title="Developers">
        <span class="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/><path d="M13 5l-2 14"/></svg></span>
        <span v-if="!collapsed" class="sb-label">Developers</span>
      </NuxtLink>
      <a href="/status" target="_blank" class="sb-link" title="System Status">
        <span class="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg></span>
        <span v-if="!collapsed" class="sb-label">Status</span>
      </a>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';

defineProps<{ collapsed: boolean; mobileOpen?: boolean }>();
defineEmits<{ toggle: []; closeMobile: [] }>();

const route = useRoute();

const I = {
  // Overview — layered dashboard panels
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="10" rx="1.6"/><rect x="13" y="3" width="8" height="6" rx="1.6"/><rect x="3" y="15" width="8" height="6" rx="1.6"/><rect x="13" y="11" width="8" height="10" rx="1.6"/></svg>',
  // Wallet — card with rounded tab
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H17a2 2 0 0 1 2 2v1"/><rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M16 12.5h3.5a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H16a1.5 1.5 0 0 1 0-3z" fill="currentColor" stroke="none"/></svg>',
  // Voice — handset
  voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h2.2a1 1 0 0 1 1 .76l.9 3.4a1 1 0 0 1-.5 1.13l-1.7.9a13 13 0 0 0 5.6 5.6l.9-1.7a1 1 0 0 1 1.13-.5l3.4.9a1 1 0 0 1 .76 1V21a1.5 1.5 0 0 1-1.6 1.5C9.7 21.8 2.2 14.3 1.5 5.1A1.5 1.5 0 0 1 3 3.5z"/></svg>',
  // AI — spark / intelligence
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9a3 3 0 0 0 1.8 1.8L20.5 11.5l-4.9 1.8a3 3 0 0 0-1.8 1.8L12 20l-1.8-4.9a3 3 0 0 0-1.8-1.8L3.5 11.5l4.9-1.8a3 3 0 0 0 1.8-1.8z"/><path d="M19 3.5v3M20.5 5h-3" opacity="0.6"/></svg>',
  // Team — two people
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" opacity="0.75"/></svg>',
  // Telroi One — stacked suite / layers
  suite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8.5 4.5L12 12 3.5 7.5z"/><path d="M3.5 12L12 16.5 20.5 12" opacity="0.7"/><path d="M3.5 16.5L12 21l8.5-4.5" opacity="0.45"/></svg>',
  // Settings — gear
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};

// Column-style grouped navigation: standalone links + collapsible sections.
const sections = [
  { label: 'Overview', to: '/', icon: I.overview, tour: 'nav-overview' },
  { label: 'Wallet', to: '/wallet', icon: I.wallet, tour: 'nav-wallet' },
  {
    label: 'Voice', icon: I.voice, tour: 'nav-voice', children: [
      { label: 'Calls', to: '/calls' },
      { label: 'Numbers', to: '/numbers' },
      { label: 'Connect', to: '/connect' },
      { label: 'SIP', to: '/sip' },
      { label: 'Blacklist', to: '/blacklist' }
    ]
  },
  {
    label: 'AI', icon: I.ai, tour: 'nav-ai', children: [
      { label: 'AI Numbers', to: '/vans' },
      { label: 'AI Connections', to: '/ai' },
      { label: 'Optimize', to: '/optimize' }
    ]
  },
  {
    label: 'Team', icon: I.team, children: [
      { label: 'People', to: '/people' },
      { label: 'Teams', to: '/teams' }
    ]
  },
  {
    label: 'Telroi One', icon: I.suite, tour: 'nav-crm', children: [
      { label: 'CRM', to: '/crm' },
      { label: 'Live Call', to: '/live-call' },
      { label: 'Apps & Integrations', to: '/apps' }
    ]
  },
  { label: 'Settings', to: '/settings', icon: I.settings }
];

// Open the section that contains the current route by default.
function sectionMatches(section: any) {
  return section.children?.some((c: any) => route.path === c.to || route.path.startsWith(c.to + '/'));
}
// Explicit open/closed choices the user has made. `undefined` for a section
// means "not touched yet" → fall back to auto-opening the section that contains
// the current route. Once the user toggles, their choice wins (even closing a
// section they're currently inside).
const openSections = ref<Record<string, boolean | undefined>>(
  Object.fromEntries(sections.filter((s) => s.children && sectionMatches(s)).map((s) => [s.label, true]))
);
function isOpen(section: any) {
  const explicit = openSections.value[section.label];
  return explicit === undefined ? sectionMatches(section) : explicit;
}
function toggle(label: string) {
  const section = sections.find((s) => s.label === label);
  // Toggle relative to what's actually shown right now, so the first click
  // always flips it (no "click twice to close" when on a matching route).
  const currentlyOpen = section ? isOpen(section) : !!openSections.value[label];
  openSections.value[label] = !currentlyOpen;
}
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
/* When collapsed, center every nav row and the footer icons within the rail. */
.sidebar.collapsed .sb-nav { padding: 10px 0; align-items: center; }
.sidebar.collapsed .sb-footer { padding: 8px 0; align-items: center; }
.sidebar.collapsed .sb-link,
.sidebar.collapsed .sb-section-head {
  width: 44px; padding: 10px 0; justify-content: center; gap: 0;
}
.sidebar.collapsed .sb-icon { margin: 0; }

.sb-nav { flex: 1; padding: 10px 12px; display: flex; flex-direction: column; gap: 1px; overflow-y: auto; }

.sb-link, .sb-section-head {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 9px 12px; border-radius: var(--radius-sm);
  color: var(--ink-soft); font-size: 14px; font-weight: 500;
  transition: background 0.12s, color 0.12s; text-align: left;
}
.sb-link:hover, .sb-section-head:hover { background: var(--paper-2); color: var(--ink); }
.sb-link.router-link-exact-active { background: var(--signal-soft); color: var(--signal); }
.sb-icon { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; }
.sb-icon :deep(svg) { width: 20px; height: 20px; }
.sb-label { white-space: nowrap; flex: 1; }
.sb-caret { width: 16px; height: 16px; color: var(--ink-mute); transition: transform 0.18s; display: inline-flex; }
.sb-caret :deep(svg) { width: 14px; height: 14px; }
.sb-caret.open { transform: rotate(180deg); }

.sb-children { display: flex; flex-direction: column; gap: 1px; padding: 2px 0 4px 0; overflow: hidden; }
.sb-child {
  display: block; padding: 8px 12px 8px 44px;
  font-size: 13.5px; color: var(--ink-soft); border-radius: var(--radius-sm);
  transition: background 0.12s, color 0.12s;
}
.sb-child:hover { background: var(--paper-2); color: var(--ink); }
.sb-child.router-link-exact-active { color: var(--signal); font-weight: 500; }

.sb-expand-enter-active, .sb-expand-leave-active { transition: opacity 0.15s, max-height 0.2s var(--motion-ease); max-height: 300px; }
.sb-expand-enter-from, .sb-expand-leave-to { opacity: 0; max-height: 0; }

.sb-footer { padding: 8px 12px; border-top: 1px solid var(--rule-2); display: flex; flex-direction: column; gap: 1px; }

.sb-collapse { padding: 6px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: var(--ink-mute); transition: background 0.14s, color 0.14s; width: 30px; height: 30px; flex-shrink: 0; }
.sb-collapse:hover { background: var(--paper-2); color: var(--ink); }
.sb-collapse svg { width: 18px; height: 18px; }

@media (max-width: 820px) {
  /* Off-canvas drawer: slide the full sidebar in from the left. */
  .sidebar {
    position: fixed; top: 0; left: 0; z-index: 60; height: 100vh;
    width: 270px; box-shadow: var(--shadow-pop);
    transform: translateX(-100%); transition: transform 0.24s var(--motion-ease);
  }
  .sidebar.mobile-open { transform: translateX(0); }

  /* On mobile the drawer is ALWAYS the full nav — completely neutralize the
     desktop "collapsed rail" styling so a leftover collapsed flag from a
     desktop session can't distort the drawer layout. */
  .sidebar.collapsed { width: 270px; }
  .sidebar.collapsed .sb-head { height: var(--topbar-h); padding: 18px 16px 18px 20px; flex-direction: row; gap: 0; justify-content: space-between; align-items: center; }
  .sidebar.collapsed .sb-brand { flex: 1; justify-content: flex-start; width: auto; }
  .sidebar.collapsed .sb-nav { padding: 10px 12px; align-items: stretch; }
  .sidebar.collapsed .sb-footer { padding: 8px 12px; align-items: stretch; }
  .sidebar.collapsed .sb-link,
  .sidebar.collapsed .sb-section-head { width: 100%; padding: 9px 12px; justify-content: flex-start; gap: 12px; }
  .sidebar.collapsed .sb-icon { margin: 0; }
  .sidebar.collapsed .sb-label,
  .sidebar.collapsed .sb-caret { display: inline-flex; }
  .sidebar.collapsed .sb-brand img.mark { display: none; }
}
</style>
