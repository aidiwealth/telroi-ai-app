<template>
  <div class="pc">
    <div class="pc-card">
      <h1 class="pc-h">Payment received</h1>
      <p class="pc-p">Taking you back to the app&hellip;</p>
      <p class="pc-note muted">
        If nothing happens, <a :href="walletHref">open your wallet</a> — your balance updates within a minute of the payment clearing.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Handed back to the app after a payment.
//
// returnTo is validated as a path on our own domain, so it cannot be an app
// scheme — but a page on that domain can bounce to one, which is what lets
// Android return control instead of leaving somebody in a browser wondering
// whether their money arrived.
//
// It does not confirm the payment. The provider's webhook lands separately and
// may not have arrived yet, so claiming success here would sometimes be a lie.
// The app polls the wallet, which is the only thing that actually knows.
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const walletHref = '/wallet';

onMounted(() => {
  // Whatever the provider appended — a reference, usually — travels with it, so
  // the app can look up what it was for rather than guessing.
  const qs = new URLSearchParams(route.query as Record<string, string>).toString();
  const target = `telroi://payment-complete${qs ? `?${qs}` : ''}`;
  try { window.location.href = target; } catch { /* the link below is the fallback */ }
});
</script>

<style scoped>
.pc { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.pc-card { max-width: 380px; text-align: center; }
.pc-h { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
.pc-p { font-size: 14px; color: var(--ink-soft); margin: 0 0 16px; }
.pc-note { font-size: 12.5px; line-height: 1.55; }
</style>
