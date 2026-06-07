<template>
  <div class="al-wrap">
    <img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" class="al-logo" />
    <div class="al-card">
      <span class="al-tag">Operator console</span>
      <template v-if="phase === 'email'">
        <h1>Operator sign-in</h1>
        <p class="al-lede">Restricted to platform administrators.</p>
        <input v-model="email" class="al-input" type="email" placeholder="you@telroi.ai" @keyup.enter="request" />
        <div v-show="cap.enabled.value" id="captcha-widget" class="al-captcha"></div>
        <button class="btn btn-signal btn-block" :disabled="busy" @click="request">{{ busy ? 'Sending…' : 'Continue' }}</button>
      </template>
      <template v-else>
        <h1>Enter code</h1>
        <p class="al-lede">Sent to {{ email }}.</p>
        <input v-model="code" class="al-input mono al-code" maxlength="6" placeholder="000000" @keyup.enter="verify" />
        <button class="btn btn-signal btn-block" :disabled="busy || code.length < 6" @click="verify">{{ busy ? 'Verifying…' : 'Sign in' }}</button>
      </template>
      <p v-if="err" class="al-err">{{ err }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
definePageMeta({ layout: false });
useHead({ title: 'Operator sign-in — Telroi' });

const phase = ref<'email' | 'code'>('email');
const email = ref(''); const code = ref(''); const busy = ref(false); const err = ref('');
const cap = useCaptcha();

async function request() {
  err.value = ''; 
  if (cap.enabled.value && !cap.token.value) { err.value = 'Please complete the verification challenge.'; return; }
  busy.value = true;
  try { await $fetch('/api/auth/request', { method: 'POST', body: { email: email.value, captchaToken: cap.token.value || undefined } }); phase.value = 'code'; }
  catch (e: any) { err.value = e?.data?.error?.message || e?.data?.message || 'Failed'; if (cap.enabled.value) cap.reset(); }
  finally { busy.value = false; }
}
async function verify() {
  err.value = ''; busy.value = true;
  try {
    // Dedicated admin verify: issues a separate admin cookie, leaves any client
    // session intact, and only succeeds for platform admins.
    await $fetch('/api/admin/verify-otp', { method: 'POST', body: { email: email.value, code: code.value } });
    await navigateTo('/admin');
  } catch (e: any) {
    err.value = e?.data?.error?.message || e?.data?.message || 'Not authorized for the operator console.';
  } finally { busy.value = false; }
}
</script>

<style scoped>
.al-wrap {
  min-height: 100vh;
  background: radial-gradient(120% 80% at 50% -10%, var(--signal-soft) 0%, transparent 55%), var(--paper-2);
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding: 12vh 24px 24px;
}
.al-logo { height: 30px; display: block; margin-bottom: 22px; }
.al-card { width: 100%; max-width: 400px; background: var(--paper); border: 1px solid var(--rule);
  border-radius: var(--radius-lg); padding: 36px; box-shadow: 0 1px 2px rgba(10,10,11,0.04), 0 8px 24px rgba(10,10,11,0.04); }
.al-tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--signal); background: var(--signal-soft); padding: 2px 8px; border-radius: 999px; display: inline-block; margin-bottom: 18px; }
.al-card h1 { font-family: var(--font-display); font-size: 26px; color: var(--ink); margin-bottom: 8px; }
.al-lede { color: var(--ink-soft); font-size: 14px; margin-bottom: 22px; }
.al-input { width: 100%; padding: 12px 14px; background: var(--paper); border: 1px solid var(--rule);
  border-radius: var(--radius); color: var(--ink); font-size: 15px; outline: none; margin-bottom: 14px; }
.al-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.al-code { text-align: center; font-size: 24px; letter-spacing: 0.3em; }
.al-err { color: var(--danger); font-size: 13px; margin-top: 14px; }
.al-captcha { margin: 12px 0; display: flex; justify-content: center; }
</style>
