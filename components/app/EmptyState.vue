<template>
  <div class="empty-state">
    <div class="empty-art" v-html="art" />
    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// A single light-grey, single-color illustration per context. Kept inline as
// SVG (no external assets) and themed via currentColor so it always renders in
// the same soft grey. Stroke-only, minimal line art — calm and unobtrusive.
const props = defineProps<{
  icon?: 'calls' | 'numbers' | 'agents' | 'groups' | 'blacklist' | 'flows' | 'keys' | 'quality' | 'ai' | 'generic';
  title: string;
  description?: string;
}>();

const ART: Record<string, string> = {
  calls: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 12c-2 0-4 2-4 4 0 16 16 32 32 32 2 0 4-2 4-4v-6l-9-4-4 5c-5-2-11-8-13-13l5-4-4-9z"/>
    <path d="M40 10h14M47 4v12" opacity="0.5"/>
  </svg>`,
  numbers: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="16" y="8" width="32" height="48" rx="5"/>
    <line x1="16" y1="18" x2="48" y2="18"/><line x1="16" y1="46" x2="48" y2="46"/>
    <circle cx="32" cy="51" r="1.5" fill="currentColor"/>
    <path d="M26 30h12M26 36h8" opacity="0.5"/>
  </svg>`,
  agents: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="24" cy="22" r="8"/><path d="M10 50c0-8 6-14 14-14s14 6 14 14"/>
    <circle cx="44" cy="26" r="6" opacity="0.5"/><path d="M40 50c0-6 3-11 8-12" opacity="0.5"/>
  </svg>`,
  groups: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="32" cy="16" r="7"/><circle cx="16" cy="44" r="7"/><circle cx="48" cy="44" r="7"/>
    <path d="M32 23v10M27 38l-7 2M37 38l7 2" opacity="0.6"/>
  </svg>`,
  blacklist: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="32" cy="32" r="20"/><line x1="18" y1="18" x2="46" y2="46"/>
  </svg>`,
  flows: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="10" y="10" width="16" height="12" rx="3"/><rect x="38" y="22" width="16" height="12" rx="3"/>
    <rect x="24" y="42" width="16" height="12" rx="3"/>
    <path d="M26 16h6a4 4 0 0 1 4 4v2M46 34v2a4 4 0 0 1-4 4h-2" opacity="0.6"/>
  </svg>`,
  keys: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="22" cy="26" r="10"/><path d="M30 32l18 18M44 46l5-5M40 42l5-5"/>
  </svg>`,
  quality: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 44l12-12 8 8 14-16"/><path d="M40 24h6v6" opacity="0.6"/>
    <line x1="10" y1="52" x2="54" y2="52" opacity="0.5"/>
  </svg>`,
  ai: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="18" y="20" width="28" height="24" rx="6"/><line x1="32" y1="12" x2="32" y2="20"/>
    <circle cx="32" cy="10" r="2" fill="currentColor"/>
    <circle cx="26" cy="32" r="2.5" fill="currentColor"/><circle cx="38" cy="32" r="2.5" fill="currentColor"/>
    <path d="M12 30v6M52 30v6" opacity="0.5"/>
  </svg>`,
  generic: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="12" y="14" width="40" height="36" rx="5"/>
    <line x1="22" y1="28" x2="42" y2="28" opacity="0.6"/><line x1="22" y1="36" x2="34" y2="36" opacity="0.6"/>
  </svg>`
};

const art = computed(() => ART[props.icon || 'generic'] || ART.generic);
</script>

<style scoped>
.empty-state { text-align: center; padding: 56px 24px; color: var(--ink-soft); }
.empty-art {
  width: 88px; height: 88px; margin: 0 auto 18px;
  display: flex; align-items: center; justify-content: center;
  color: var(--rule); /* single soft-grey tone */
  background: var(--paper-2);
  border-radius: 20px;
}
.empty-art :deep(svg) { width: 52px; height: 52px; }
.empty-title { font-family: var(--font-display); font-size: 19px; color: var(--ink); margin: 0 0 6px; font-weight: 500; }
.empty-desc { font-size: 13.5px; color: var(--ink-mute); margin: 0 auto; max-width: 320px; line-height: 1.5; }
.empty-state :deep(.btn) { margin-top: 18px; }
</style>
