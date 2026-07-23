<template>
  <div class="signin">
    <img class="signin-logo" src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" />
    <div class="signin-card card">
      <!-- Step: email -->
      <template v-if="phase === 'email'">
        <div class="mode-switch" role="tablist">
          <button type="button" class="mode-tab" :class="{ on: mode === 'signin' }" role="tab" :aria-selected="mode === 'signin'" @click="switchMode('signin')">Sign in</button>
          <button type="button" class="mode-tab" :class="{ on: mode === 'signup' }" role="tab" :aria-selected="mode === 'signup'" @click="switchMode('signup')">Create account</button>
        </div>

        <div class="kicker">{{ mode === 'signin' ? 'Welcome back' : 'Get started' }}</div>
        <p class="signin-lede">
          {{ mode === 'signin'
            ? "Enter the email you signed up with and we'll send a magic link and a one-time code. No password needed."
            : "Enter your work email and we'll send a magic link and a one-time code to set up your workspace. No password needed." }}
        </p>

        <!-- Signing in with an address that has no account: say so, and offer the
             one action that helps rather than a generic failure. -->
        <div v-if="noAccount" class="no-account">
          <p class="no-account-title">No account with that email</p>
          <p class="no-account-body">We couldn't find <strong>{{ email }}</strong>. Create an account with it, or try a different address.</p>
          <button type="button" class="btn btn-signal btn-block" @click="switchMode('signup'); requestLink()">
            Create an account with this email →
          </button>
          <button type="button" class="no-account-alt" @click="noAccount = false">Use a different email</button>
        </div>

        <form v-else @submit.prevent="requestLink">
          <div class="field-float" :class="{ 'is-error': error }">
            <input id="email" v-model="email" type="email" class="input" placeholder=" " required autofocus />
            <label for="email">Work email</label>
            <span v-if="error" class="field-error">{{ error }}</span>
          </div>
          <div v-show="cap.enabled.value" id="captcha-widget" class="captcha-widget"></div>
          <button class="btn btn-signal btn-block" :disabled="busy">
            {{ busy ? 'Sending…' : (mode === 'signin' ? 'Sign in' : 'Create account') }} <span v-if="!busy" class="arrow">→</span>
          </button>
        </form>
      </template>

      <!-- Step: sent / code entry -->
      <template v-else>
        <div class="kicker">Check your inbox</div>
        <h1>Enter your <em>code</em></h1>
        <p class="signin-lede">We sent a link and a 6-digit code to <strong>{{ email }}</strong>. Click the link, or type the code below.</p>

        <div class="otp-row">
          <input
            v-for="(d, i) in 6" :key="i"
            ref="otpEls"
            class="otp-box mono"
            inputmode="numeric" maxlength="1"
            v-model="otp[i]"
            @input="onOtpInput(i, $event)"
            @keydown.backspace="onOtpBackspace(i, $event)"
            @paste="onOtpPaste"
          />
        </div>
        <span v-if="error" class="field-error otp-err">{{ error }}</span>

        <button class="btn btn-signal btn-block" :disabled="busy || otp.join('').length < 6" @click="verify">
          {{ busy ? 'Verifying…' : 'Verify & continue' }}
        </button>

        <div class="signin-foot">
          <button class="link-btn" :disabled="cooldown > 0" @click="requestLink">
            {{ cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code' }}
          </button>
          <button class="link-btn" @click="reset">Use a different email</button>
        </div>
      </template>
    </div>

    <p class="signin-legal">By continuing you agree to Telroi's Terms and Privacy Policy.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useAuthStore } from '~/stores/auth';

definePageMeta({ layout: 'bare' });
useHead({ title: 'Sign in — Telroi', bodyAttrs: { class: 'signin-centered' } });

const api = useApi();
const auth = useAuthStore();
const cap = useCaptcha();
const route = useRoute();

const phase = ref<'email' | 'code'>('email');
const email = ref('');
const otp = ref<string[]>(['', '', '', '', '', '']);
const otpEls = ref<HTMLInputElement[]>([]);
const busy = ref(false);
const error = ref('');
// Sign in and sign up share this form: same fields, different expectations.
// Signing in asserts the account already exists, so an unknown address stops
// here rather than mailing a code that would quietly create one.
const mode = ref<'signin' | 'signup'>('signin');
const noAccount = ref(false);
function switchMode(next: 'signin' | 'signup') {
  mode.value = next; error.value = ''; noAccount.value = false;
}
const cooldown = ref(0);

// Surface magic-link errors passed back via query
onMounted(() => {
  if (route.query.error) error.value = 'That link was invalid or expired. Try again.';
});

function startCooldown() {
  cooldown.value = 30;
  const id = setInterval(() => { if (--cooldown.value <= 0) clearInterval(id); }, 1000);
}

async function requestLink() {
  error.value = '';
  if (!email.value) return;
  if (cap.enabled.value && !cap.token.value) { error.value = 'Please complete the verification challenge.'; return; }
  busy.value = true;
  try {
    await api.post('/api/auth/request', { email: email.value, captchaToken: cap.token.value || undefined, intent: mode.value });
    phase.value = 'code';
    startCooldown();
    await nextTick();
    otpEls.value[0]?.focus();
  } catch (e: any) {
    // Not an error to apologise for — they just don't have an account yet.
    if (e?.data?.error?.code === 'no_account' || e?.data?.code === 'no_account') {
      noAccount.value = true;
    } else {
      error.value = e.message;
    }
    if (cap.enabled.value) cap.reset();
  } finally {
    busy.value = false;
  }
}

function onOtpInput(i: number, e: Event) {
  const v = (e.target as HTMLInputElement).value.replace(/\D/g, '');
  otp.value[i] = v.slice(-1);
  if (v && i < 5) otpEls.value[i + 1]?.focus();
}
function onOtpBackspace(i: number, e: KeyboardEvent) {
  if (!otp.value[i] && i > 0) { otpEls.value[i - 1]?.focus(); }
}
function onOtpPaste(e: ClipboardEvent) {
  e.preventDefault();
  const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
  digits.forEach((d, i) => { otp.value[i] = d; });
  otpEls.value[Math.min(digits.length, 5)]?.focus();
}

async function verify() {
  error.value = '';
  busy.value = true;
  try {
    const res = await api.post<{ hasTenant: boolean }>('/api/auth/verify-otp', { email: email.value, code: otp.value.join('') });
    // Hard navigation so the server re-hydrates auth from the just-set session
    // cookie (a client-side navigate can race the cookie/store state and bounce
    // a fully-onboarded user to /onboarding).
    auth.loaded = false;
    window.location.href = res.hasTenant ? '/' : '/onboarding';
  } catch (e: any) {
    error.value = e.message;
    busy.value = false;
  }
}

function reset() {
  phase.value = 'email';
  otp.value = ['', '', '', '', '', ''];
  error.value = '';
}
</script>

<style scoped>
.signin { width: 100%; max-width: 440px; display: flex; flex-direction: column; align-items: center; }
.signin-logo { height: 30px; display: block; margin: 0 auto 26px; }
.signin-card { padding: 36px 36px 32px; width: 100%; }
.signin-card h1 { font-size: 30px; line-height: 1.1; margin-bottom: 12px; }
.mode-switch { display: flex; gap: 4px; background: var(--surface-2, rgba(0,0,0,0.04)); border-radius: 10px; padding: 4px; margin-bottom: 22px; }
.mode-tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 8px 10px; font-size: 13.5px; font-weight: 500; color: var(--ink-soft); cursor: pointer; transition: background .15s, color .15s; }
.mode-tab.on { background: var(--surface, #fff); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.no-account { border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.no-account-title { font-size: 15px; font-weight: 600; color: var(--ink); margin: 0 0 6px; }
.no-account-body { font-size: 13.5px; color: var(--ink-soft); line-height: 1.55; margin: 0 0 16px; }
.no-account-alt { display: block; width: 100%; margin-top: 10px; border: 0; background: none; font-size: 13px; color: var(--ink-soft); cursor: pointer; padding: 6px; }
.no-account-alt:hover { color: var(--ink); }
.signin-lede { color: var(--ink-soft); font-size: 14.5px; line-height: 1.55; margin-bottom: 26px; }
.signin-lede strong { color: var(--ink); font-weight: 500; }

.otp-row { display: flex; gap: 10px; margin-bottom: 8px; }
.otp-box {
  width: 52px; height: 60px; flex: 0 0 52px;
  padding: 0; text-align: center;
  font-size: 24px; font-weight: 600; line-height: 60px;
  background: var(--paper);
  border: 1px solid var(--rule); border-radius: var(--radius);
  outline: none; transition: border-color 0.15s, box-shadow 0.15s;
}
.otp-box:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.otp-err { display: block; margin: 4px 0 0; }

.signin-card form .btn, .otp-row + .field-error + .btn, .signin-card .btn-block { margin-top: 8px; }
.captcha-widget { margin: 14px 0 4px; display: flex; justify-content: center; min-height: 0; }
.signin-foot { display: flex; justify-content: space-between; margin-top: 18px; }
.link-btn { font-size: 13px; color: var(--signal); }
.link-btn:disabled { color: var(--ink-mute); cursor: default; }
.signin-legal { text-align: center; color: var(--ink-mute); font-size: 12px; margin-top: 22px; }
</style>
