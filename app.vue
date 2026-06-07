<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- Global toasts -->
    <ClientOnly>
      <div class="toast-stack">
        <TransitionGroup name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.kind === 'ok' ? 'ok' : t.kind === 'err' ? 'err' : ''}`">
            {{ t.msg }}
          </div>
        </TransitionGroup>
      </div>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
const { toasts } = useToast();
</script>

<style>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
