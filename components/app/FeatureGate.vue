<template>
  <div class="fg-wrap">
    <!-- The feature content, blurred when locked -->
    <div :class="{ 'fg-locked': !allowed }">
      <slot />
    </div>

    <!-- Upgrade overlay -->
    <div v-if="!allowed" class="fg-overlay">
      <div class="fg-card">
        <div class="fg-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 class="fg-title">{{ title }} is a <em>Growth</em> feature</h2>
        <p class="fg-lede">{{ blurb }}</p>
        <div class="fg-actions">
          <NuxtLink to="/settings?tab=plan" class="btn btn-signal">Upgrade to Growth</NuxtLink>
          <span class="fg-trial" v-if="trialDays">or start a {{ trialDays }}-day free trial</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const props = defineProps<{ feature: string; title: string; blurb?: string; bypass?: boolean }>();

const { state, has, load } = usePlan();
const ready = ref(false);

onMounted(async () => { if (props.bypass) { ready.value = true; return; } await load(); ready.value = true; });

// Until loaded, assume allowed (avoid a flash of the lock for entitled users).
// `bypass` is for internal workspaces (e.g. admin support) that are always entitled.
const allowed = computed(() => props.bypass || !ready.value || has(props.feature));
const trialDays = computed(() => state.value?.trialDays || 0);
const blurb = computed(() => props.blurb || 'Upgrade to the Growth plan to unlock this, along with the full Telroi One suite — CRM, desktop dialer, team messenger and more.');
</script>

<style scoped>
.fg-wrap { position: relative; }
.fg-locked { filter: blur(5px); pointer-events: none; user-select: none; opacity: 0.7; max-height: 80vh; overflow: hidden; }
.fg-overlay { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; background: linear-gradient(180deg, rgba(247,246,243,0.4), rgba(247,246,243,0.85)); }
.fg-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 8px 40px rgba(10,10,11,0.1); }
.fg-icon { width: 44px; height: 44px; border-radius: 12px; background: var(--signal-soft); color: var(--signal); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
.fg-icon svg { width: 22px; height: 22px; }
.fg-title { font-family: var(--font-display); font-size: 22px; color: var(--ink); margin-bottom: 8px; }
.fg-title em { font-style: italic; color: var(--signal); }
.fg-lede { font-size: 13.5px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 20px; }
.fg-actions { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.fg-trial { font-size: 12.5px; color: var(--ink-mute); }
</style>
