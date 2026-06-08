<script setup lang="ts">
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();
const code = computed(() => props.error?.statusCode || 500);
const isNotFound = computed(() => code.value === 404);
const title = computed(() => (isNotFound.value ? 'Page not found' : 'Something went wrong'));
const message = computed(() =>
  isNotFound.value
    ? "The page you're looking for doesn't exist or has moved."
    : 'An unexpected error occurred. Please try again in a moment.'
);

function goHome() { clearError({ redirect: '/' }); }
</script>

<template>
  <div class="err-wrap">
    <div class="err-card">
      <p class="err-code">{{ code }}</p>
      <h1 class="err-title">{{ title }}</h1>
      <p class="err-msg">{{ message }}</p>
      <button class="err-btn" @click="goHome">Go to homepage</button>
    </div>
  </div>
</template>

<style scoped>
.err-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0C2057; padding: 24px; }
.err-card { text-align: center; max-width: 420px; color: #F5F2EC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.err-code { font-size: 64px; font-weight: 700; margin: 0; color: #C8962E; line-height: 1; }
.err-title { font-size: 22px; font-weight: 600; margin: 16px 0 8px; }
.err-msg { font-size: 15px; opacity: 0.8; margin: 0 0 24px; line-height: 1.5; }
.err-btn { background: #C8962E; color: #0C2057; border: 0; border-radius: 8px; padding: 11px 22px; font-size: 14px; font-weight: 600; cursor: pointer; }
.err-btn:hover { opacity: 0.92; }
</style>
