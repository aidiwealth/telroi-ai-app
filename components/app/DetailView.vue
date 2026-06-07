<template>
  <div class="detail">
    <!-- Header: big amount/title + status pills + ID -->
    <div class="detail-head">
      <div class="detail-head-main">
        <div class="detail-headline">{{ headline }}</div>
        <div class="detail-pills">
          <span v-for="pill in pills" :key="pill.label" class="detail-pill" :class="`p-${pill.tone || 'neutral'}`">
            <span v-if="pill.dot" class="detail-pill-dot" />{{ pill.label }}
          </span>
        </div>
      </div>
      <div v-if="resourceId" class="detail-id">
        <div class="detail-id-label">{{ idLabel || 'ID' }}</div>
        <div class="detail-id-value mono">{{ resourceId }}</div>
      </div>
    </div>

    <!-- Body: timeline left, content right -->
    <div class="detail-body">
      <div v-if="timeline?.length" class="detail-timeline">
        <div class="detail-timeline-title">Timeline</div>
        <div class="timeline">
          <div v-for="(step, i) in timeline" :key="i" class="timeline-step" :class="{ done: step.done, current: step.current }">
            <div class="timeline-dot">{{ step.done ? '✓' : '' }}</div>
            <div>
              <div class="timeline-label">{{ step.label }}</div>
              <div v-if="step.time" class="timeline-time">{{ step.time }}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="detail-content"><slot /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Pill { label: string; tone?: 'ok' | 'warn' | 'danger' | 'neutral' | 'signal'; dot?: boolean }
interface Step { label: string; time?: string; done?: boolean; current?: boolean }
defineProps<{
  headline: string;
  pills?: Pill[];
  resourceId?: string;
  idLabel?: string;
  timeline?: Step[];
}>();
</script>

<style scoped>
.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--rule); margin-bottom: 28px; }
.detail-headline { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-bottom: 12px; }
.detail-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.detail-pill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 500; border: 1px solid var(--rule); color: var(--ink-soft); }
.detail-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.p-ok { color: #0a8a5c; border-color: rgba(0,210,138,0.35); background: rgba(0,210,138,0.08); }
.p-warn { color: var(--warn); border-color: rgba(183,121,31,0.3); background: rgba(183,121,31,0.07); }
.p-danger { color: var(--danger); border-color: rgba(192,57,43,0.3); background: rgba(192,57,43,0.06); }
.p-signal { color: var(--signal); border-color: rgba(26,75,114,0.25); background: var(--signal-soft); }

.detail-id { text-align: right; flex-shrink: 0; }
.detail-id-label { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 6px; }
.detail-id-value { font-size: 12.5px; padding: 8px 12px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: var(--radius-sm); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.detail-body { display: grid; grid-template-columns: 240px 1fr; gap: 40px; }
.detail-timeline-title, .detail-content :deep(.detail-section-title) { font-size: 13px; font-weight: 600; margin-bottom: 16px; }
@media (max-width: 820px) { .detail-body { grid-template-columns: 1fr; gap: 28px; } }
</style>
