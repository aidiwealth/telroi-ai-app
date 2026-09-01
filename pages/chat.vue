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

/* Open the panel once the widget has mounted.
 *
 * toggleVisibility sets the state rather than flipping it — it calls
 * setVisible(e) internally — so calling it more than once is harmless. Which
 * matters: the app sees onPageFinished more than once, and a true toggle would
 * have closed the panel as often as it opened it.
 *
 * The script's onload fires before the widget has mounted its own apps, and the
 * function returns silently until it has. So this retries briefly rather than
 * calling once and trusting it. */
function openPanel(attempt = 0) {
  const w = (window as any).LiveChatWidget;
  // The elements, not the function. The function exists as soon as the script
  // parses and returns silently until the widget has mounted — so waiting for
  // it to be callable was waiting for the wrong thing, and the loop declared
  // success on a call that did nothing.
  const content = document.getElementById('live-chat-content');
  try {
    if (w && typeof w.toggleVisibility === 'function' && content) {
      w.toggleVisibility(true);
      // The launcher is redundant once the panel is open on a screen that is
      // only ever chat. Hidden in CSS rather than removed, since the widget
      // manages its own DOM and rewrites it after opening.
      const st = document.createElement('style');
      // The real ids, read from the DOM rather than guessed from the bundle:
      // live-chat-toggle is the launcher and live-chat-content is the panel.
      st.textContent = '#live-chat-toggle{display:none !important}'
        + '#live-chat-content{width:100% !important;height:100% !important;'
        + 'max-height:100% !important;inset:0 !important;border-radius:0 !important}';
      document.head.appendChild(st);
      // Say what happened. A widget that reports nothing is how the last two
      // days went, and this one has already looked like three different faults.
      console.log('[chat] opened; toggle:',
        !!document.getElementById('live-chat-toggle'),
        'content:', !!document.getElementById('live-chat-content'));
      note.value = '';
      return;
    }
  } catch { /* fall through and retry */ }
  // Roughly five seconds. Longer than a widget takes on a poor connection, and
  // short enough that a person is not staring at a blank screen if it fails.
  if (attempt < 25) setTimeout(() => openPanel(attempt + 1), 200);
  else note.value = 'Chat is taking longer than usual to load.';
}

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

  // ?open=1 opens the panel and hides the launcher. A corner bubble is right
  // for a website and wrong for a screen whose whole purpose is chat — and the
  // page can do it where the app cannot, because it knows when the script
  // finished rather than polling for a global to appear.
  const wantOpen = q.get('open') === '1';

  const s = document.createElement('script');
  s.src = 'https://widget.termii.com/01a04b2d-8706-71a7-ab66-273e131382ae.js';
  s.async = true;
  s.onerror = () => { note.value = 'Chat could not load. Check your connection and try again.'; };
  s.onload = () => { if (wantOpen) openPanel(); };
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
