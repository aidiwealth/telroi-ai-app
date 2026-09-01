<template>
  <div class="chat">
    <p class="chat-wait">{{ note }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

/* A page on our own origin, for the chat widget inside a WebView.
 *
 * The widget builds its panel by writing into a src-less iframe, which inherits
 * the parent document's origin — and a WebView loaded through
 * loadDataWithBaseURL has an opaque one, so the write is blocked and the panel
 * opens empty. Loading this URL instead gives the frame a real origin to
 * inherit.
 *
 * Public, because the app passes who the person is rather than the page looking
 * it up. Requiring a session would mean the WebView carrying our cookies, which
 * is more moving parts for no more safety: the widget is a support line, and
 * the name and email are supplied by the caller either way.
 */
definePageMeta({ layout: false });

const note = ref('Opening chat…');

onMounted(() => {
  const q = new URLSearchParams(window.location.search);
  const name = (q.get('name') || '').trim();
  const email = (q.get('email') || '').trim();
  const phone = (q.get('phone') || '').trim();

  // Before the script, not after: the widget reads its settings when it
  // initialises, and a mounted hook that ran later would leave it unnamed on
  // some loads and named on others.
  (window as any).liveChatSettings = {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {})
  };

  const s = document.createElement('script');
  s.src = 'https://widget.termii.com/01a04b2d-8706-71a7-ab66-273e131382ae.js';
  s.async = true;
  s.onerror = () => { note.value = 'Chat could not load. Check your connection and try again.'; };
  document.head.appendChild(s);

  // The address is cleaned once the widget has what it needs. A name and email
  // in a URL end up in history and in every log line that records the request,
  // and neither is a good place for them to sit.
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch { /* an unclean URL is worse than nothing, not fatal */ }
});
</script>

<style>
/* No layout and no shell: this sits under the app's own header, and anything
   we drew here would be a second one. */
html, body, #__nuxt { height: 100%; margin: 0; background: #fff; }
.chat { height: 100%; display: flex; align-items: center; justify-content: center; }
.chat-wait { font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #8b8b93; }
</style>
