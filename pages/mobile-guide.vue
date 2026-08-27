<template>
  <div class="mtour">
    <header class="mt-top">
      <span class="mt-title">Using the Telroi app</span>
      <span class="mt-sp" />
      <NuxtLink v-if="!signedIn" to="/login" class="mt-signin">Sign in</NuxtLink>
      <div v-else class="mt-me" @click="menu = !menu">
        <span class="mt-av">{{ initials }}</span>
        <div v-if="menu" class="mt-menu">
          <NuxtLink to="/" class="mt-mi">Return to dashboard</NuxtLink>
          <NuxtLink to="/guide" class="mt-mi">The web app tour</NuxtLink>
        </div>
      </div>
    </header>

    <div class="stage">
      <!-- On a phone the rail becomes a bar that opens on tap: twenty screens
           stacked above the device would push it off the fold. -->
      <button class="mt-railtoggle" @click="railOpen = !railOpen">
        <span>{{ currentLabel }}</span>
        <span class="mt-caret" :class="{ up: railOpen }">&#9662;</span>
      </button>

      <aside class="rail" :class="{ open: railOpen }">
        <h1>Telroi Mobile</h1>
        <div class="sub">Every screen in the app, with what it is for. Tap through the
          phone, or pick a screen.</div>

        <div class="menu">
          <template v-for="g in GROUPS" :key="g.label">
            <div class="grp">{{ g.label }}</div>
            <button v-for="s in g.items" :key="s.id"
                    class="nav" :class="{ on: current === s.id, kid: s.kid }"
                    :data-go="s.id" @click="pick(s.id)">{{ s.label }}</button>
          </template>
        </div>

        <a href="/guide" class="mt-sidelink">The web app tour &rarr;</a>
      </aside>

      <div class="deviceCol">
        <div class="phone"><div class="app" id="mt-app" /></div>
        <div class="caption" id="mt-caption" />
      </div>

      <!-- What the screen is for. The prototype wrapped window.render to paint
           this; the page already knows which screen is showing, so it renders
           it directly. -->
      <aside class="notes" v-html="note" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { mountMobileTour } from '~/composables/mobileTour';
import { MOBILE_NOTES } from '~/composables/mobileNotes';
import { useAuthStore } from '~/stores/auth';

/* Its own page rather than the app shell, like the web tour. Nothing here reads
   a workspace — every screen is an imaginary one — so it needs no account and
   shows nobody's data. */
definePageMeta({ layout: 'bare' });
useHead({
  title: 'Using the Telroi app — Telroi',
  script: [{
    src: 'https://app.telroi.ai/widget/v1.js',
    'data-telroi-key': 'wgt_ec9ae0fdd28f1a2a4a73b0a65dde9437',
    async: true
  }]
});

const GROUPS = [
  { label: 'Getting in', items: [
    { id: 'signin', label: 'Sign in' }, { id: 'otp', label: 'Enter code' } ] },
  { label: 'Home', items: [ { id: 'home', label: 'Home' } ] },
  { label: 'Calls', items: [
    { id: 'calls', label: 'Call history' }, { id: 'detail', label: 'A call', kid: true },
    { id: 'dialer', label: 'Dialler' }, { id: 'incoming', label: 'Incoming call' },
    { id: 'incall', label: 'In call' } ] },
  { label: 'Contacts', items: [
    { id: 'contacts', label: 'Contacts' },
    { id: 'contactDetail', label: 'One contact', kid: true } ] },
  { label: 'Wallet', items: [
    { id: 'wallet', label: 'Wallet' }, { id: 'statement', label: 'Statement', kid: true },
    { id: 'txn', label: 'One transaction', kid: true } ] },
  { label: 'Settings', items: [
    { id: 'settings', label: 'Settings' }, { id: 'numbers', label: 'Numbers', kid: true },
    { id: 'buynumber', label: 'Buy a number', kid: true },
    { id: 'numberDetail', label: 'One number', kid: true },
    { id: 'team', label: 'Team', kid: true }, { id: 'golive', label: 'Go live', kid: true },
    { id: 'help', label: 'Help', kid: true } ] }
];

const auth = useAuthStore();
const menu = ref(false);
const railOpen = ref(false);
const current = ref('signin');
const signedIn = computed(() => !!auth.user);
const initials = computed(() => {
  const n = auth.user?.name || auth.user?.email || '';
  return n.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase()).join('') || '?';
});
const note = computed(() => MOBILE_NOTES[current.value]
  || '<p class="nkick">Telroi mobile</p><h2>This screen</h2>'
   + '<p class="nlede">Pick a screen from the menu, or tap through the phone.</p>');
const currentLabel = computed(() => {
  for (const g of GROUPS) for (const s of g.items) if (s.id === current.value) return s.label;
  return 'Screens';
});

let tour: ReturnType<typeof mountMobileTour> | null = null;

onMounted(() => {
  const root = document.querySelector('.mtour') as HTMLElement;
  if (!root) return;
  tour = mountMobileTour(root);
  // Delegated, as the prototype had it: the screens are redrawn wholesale on
  // every tap, so per-element handlers would need rebinding each time.
  root.addEventListener('click', tour.onClick);
  const h = location.hash.slice(1);
  // Signing in, because that is where somebody being shown the app starts.
  pick(h && tour.views.includes(h) ? h : 'signin');
});

onBeforeUnmount(() => {
  const root = document.querySelector('.mtour') as HTMLElement;
  if (root && tour) root.removeEventListener('click', tour.onClick);
});

function pick(id: string) {
  current.value = id;
  railOpen.value = false;
  history.replaceState(null, '', '#' + id);
  tour?.render(id);
}
</script>


<style>

/* ============================================================
   Tokens — ported verbatim from assets/css/tokens.css, plus the
   handful of mobile-only values the web app has no need for.
   ============================================================ */
.mtour{
  --ink:#0A0A0B; --ink-soft:#5b5b62; --ink-mute:#8b8b93;
  --paper:#ffffff; --paper-2:#f7f6f3; --paper-3:#f1efea;
  --rule:#e7e5e0; --rule-2:#ebe9e4;
  --signal:#1a4b72; --signal-2:#123857; --signal-soft:#e7eef4; --signal-bright:#4d83b3;
  --live:#00d28a; --danger:#c0392b; --warn:#1a4b72;
  --green-ink:#0a8a5c;

  --font-display:"Sharp Grotesk","Mabry Pro",Georgia,serif;
  --font-sans:"Mabry Pro",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;

  --radius:12px; --radius-lg:20px; --radius-sm:8px;
  --motion-ease:cubic-bezier(0.4,0,0.2,1);

  /* mobile shell */
  --gut:20px;          /* single horizontal gutter, everywhere */
  --hdr-h:52px;
  --tab-h:56px;
  --safe-b:26px;       /* home indicator */
  --row-h:70px;
  --sheet-r:24px;
}
html.dark .mtour{
  --ink:#f3f3f5; --ink-soft:#b5b5be; --ink-mute:#8a8a94;
  --paper:#1b1b21; --paper-2:#141417; --paper-3:#26262c;
  --rule:#3a3a44; --rule-2:#45454f;
  --signal:#5b9bd0; --signal-2:#7db0dd; --signal-soft:#1f3242; --signal-bright:#7db0dd;
  --live:#1fdd9a; --danger:#e0685c; --warn:#5b9bd0; --green-ink:#1fdd9a;
  color-scheme:dark;
}
.mtour *, .mtour *::before, .mtour *::after{box-sizing:border-box}
.mtour{margin:0;color:var(--ink);font-family:var(--font-sans);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.mtour button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.mtour ul, .mtour ol{list-style:none;margin:0;padding:0}
.mtour h1, .mtour h2, .mtour h3{margin:0;font-weight:400}
.mtour p{margin:0}
.mtour svg{display:block}
/* ============================================================
   Stage — the chrome around the phone. Not part of the design.
   ============================================================ */
.mtour .stage{display:flex;gap:40px;padding:40px;min-height:100vh;align-items:flex-start;justify-content:center}
.mtour .rail{width:210px;position:sticky;top:40px;flex-shrink:0}
.mtour .rail h1{font-family:var(--font-display);font-size:19px;letter-spacing:-.02em;margin-bottom:2px}
.mtour .rail .sub{font-size:12.5px;color:var(--ink-soft);line-height:1.45;margin-bottom:22px}
.mtour .rail .grp{font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ink-mute);margin:20px 0 7px}
.mtour .rail button.nav{display:block;width:100%;text-align:left;padding:7px 11px;border-radius:8px;
  font-size:13.5px;color:var(--ink-soft);transition:background .15s,color .15s}
.mtour .rail button.nav[data-go^="—"], .mtour .rail button.nav{white-space:nowrap}
.mtour .rail button.nav:hover{background:var(--paper-2);color:var(--ink)}
.mtour .rail button.nav.on{background:var(--signal-soft);color:var(--signal);font-weight:500}
.mtour .rail .themebtn{margin-top:26px;padding:8px 14px;border:1px solid var(--rule);border-radius:999px;
  font-size:12.5px;color:var(--ink-soft);background:var(--paper)}
.mtour .rail .themebtn:hover{border-color:var(--ink);color:var(--ink)}
.mtour .deviceCol{display:flex;flex-direction:column;align-items:center;gap:14px}
.mtour .phone{width:390px;height:844px;border-radius:46px;background:var(--paper);overflow:hidden;
  position:relative;box-shadow:0 0 0 10px #17171a,0 0 0 11px #303036,0 40px 80px -30px rgba(10,10,11,.45);
  flex-shrink:0}
.mtour .caption{font-size:12.5px;color:var(--ink-soft);max-width:390px;text-align:center;line-height:1.5}
.mtour .caption b{color:var(--ink);font-weight:500}
/* ============================================================
   App shell
   ============================================================ */
.mtour .app{position:absolute;inset:0;background:var(--paper-2);overflow:hidden}
.mtour .scr{position:absolute;inset:0;display:none;flex-direction:column;background:var(--paper-2)}
.mtour .scr.on{display:flex;animation:scrin .26s var(--motion-ease)}
@keyframes scrin{from{opacity:0;transform:translateX(9px)}to{opacity:1;transform:none}}
.mtour .scr.dark-scr{background:#0A0A0B;color:#f3f3f5}
/* status bar */
.mtour .sbar{height:50px;flex-shrink:0;display:flex;align-items:flex-end;justify-content:space-between;
  padding:0 30px 6px;font-size:13px;font-weight:500;letter-spacing:.01em}
.mtour .sbar .rt{display:flex;align-items:center;gap:6px}
.mtour .dark-scr .sbar{color:#f3f3f5}
/* header */
.mtour .hdr{flex-shrink:0;padding:2px var(--gut) 12px;transition:padding .2s var(--motion-ease)}
.mtour .hdr .toprow{display:flex;align-items:center;gap:8px;height:38px;margin-bottom:4px}
.mtour .wspill{display:flex;align-items:center;gap:5px;font-size:13.5px;font-weight:500;letter-spacing:-.005em;
  color:var(--ink);padding:4px 8px 4px 0;border-radius:999px}
.mtour .wspill .cv{color:var(--ink-mute)}
.mtour .envdot{display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 7px;border-radius:999px;
  font-size:10.5px;letter-spacing:.02em;background:color-mix(in srgb,var(--warn) 12%,transparent);color:var(--warn)}
.mtour .envdot .pulse{width:5px;height:5px;border-radius:999px;background:currentColor;animation:pulse 1.6s ease-in-out infinite}
.mtour .hdr .big{font-family:var(--font-display);font-size:27px;letter-spacing:-.025em;line-height:1.1}
.mtour .hdr.compact{display:flex;align-items:center;gap:10px;padding-top:4px;padding-bottom:10px;
  border-bottom:1px solid var(--rule)}
.mtour .hdr.compact .ttl{font-size:16px;font-weight:500;letter-spacing:-.01em}
.mtour .hdr.compact .sub{font-size:12px;color:var(--ink-mute);margin-top:1px}
.mtour .hdr .spacer{flex:1}
.mtour .iconbtn{width:34px;height:34px;border-radius:999px;display:flex;align-items:center;justify-content:center;
  color:var(--ink-soft);transition:background .15s,color .15s;flex-shrink:0}
.mtour .iconbtn:hover{background:var(--paper-3);color:var(--ink)}
.mtour .avatar{width:32px;height:32px;border-radius:999px;background:var(--signal);color:#fff;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;letter-spacing:.02em}
/* scroll body */
.mtour .body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:40px}
.mtour .body::-webkit-scrollbar{width:0}
.mtour .pad{padding:0 var(--gut)}
/* tab bar */
.mtour .tabs{flex-shrink:0;height:calc(var(--tab-h) + var(--safe-b));padding-bottom:var(--safe-b);
  background:var(--paper);border-top:1px solid var(--rule);display:flex;align-items:stretch}
.mtour .tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  color:var(--ink-mute);transition:color .15s}
.mtour .tab .lbl{font-size:10px;letter-spacing:.01em}
.mtour .tab.on{color:var(--signal)}
.mtour .tab.dialkey{flex:0 0 74px;position:relative}
.mtour .tab.dialkey .key{width:50px;height:50px;border-radius:999px;background:var(--ink);color:var(--paper);
  display:flex;align-items:center;justify-content:center;margin-top:-16px;
  box-shadow:0 8px 20px -8px rgba(10,10,11,.5);transition:transform .18s var(--motion-ease)}
.mtour .tab.dialkey:active .key{transform:scale(.94)}
/* ============================================================
   Signature: the signal bars.
   One motif at three scales — a hairline in a list row, a scrubber
   in the player, a breathing column on the in-call screen.
   ============================================================ */
.mtour .sig{display:flex;align-items:flex-end;gap:2px;height:14px}
.mtour .sig i{width:2px;background:var(--signal-bright);border-radius:1px;opacity:.5;display:block}
.mtour .sig.lg{height:52px;gap:3px;align-items:center}
.mtour .sig.lg i{width:3px;border-radius:2px;opacity:.28}
.mtour .sig.lg i.played{opacity:1;background:var(--signal)}
.mtour .sig.live i{background:var(--live);opacity:1;animation:breathe 1.1s var(--motion-ease) infinite alternate}
@keyframes breathe{from{transform:scaleY(.35)}to{transform:scaleY(1)}}
.mtour .over{position:absolute;inset:0;overflow:hidden;
  background:radial-gradient(130% 70% at 50% 8%,#1a4b72 0%,#123857 34%,#0A0A0B 72%)}
.mtour .over video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mtour .over .scrim{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(10,10,11,.62) 0%,rgba(10,10,11,.22) 30%,rgba(10,10,11,.55) 62%,rgba(10,10,11,.94) 100%)}
.mtour .over .inner{position:absolute;inset:0;display:flex;flex-direction:column;color:#f3f3f5}
.mtour .over .sbar{color:#f3f3f5}
.mtour .brandmark{display:flex;align-items:center;padding:8px var(--gut) 0}
/* The lockup is dark ink on transparent, so it vanishes on the video.
   Same flip the web app uses for its dark theme, rather than a second asset. */
.mtour .wordmark{height:26px;width:auto}
.mtour .wordmark.on-dark{filter:brightness(0) invert(1)}
.mtour .markglyph{height:22px;width:auto;opacity:.9}
html.dark .mtour .markglyph{filter:brightness(0) invert(1)}
.mtour .overcopy{margin-top:auto;padding:0 var(--gut) 26px}
.mtour .overcopy h2{font-family:var(--font-display);font-size:31px;line-height:1.12;letter-spacing:-.03em}
.mtour .overcopy p{font-size:14px;line-height:1.5;color:rgba(243,243,245,.72);margin-top:12px;max-width:290px}
.mtour .signsheet{background:var(--paper);border-radius:var(--sheet-r) var(--sheet-r) 0 0;color:var(--ink);
  padding:22px var(--gut) calc(var(--safe-b) + 16px)}
/* ============================================================
   Rows
   ============================================================ */
.mtour .rows{background:var(--paper);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.mtour .daylabel{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;
  color:var(--ink-mute);padding:20px var(--gut) 8px}
.mtour .row{display:flex;align-items:center;gap:13px;padding:0 var(--gut);min-height:var(--row-h);
  position:relative;width:100%;text-align:left;transition:background .12s}
.mtour .row:active{background:var(--paper-2)}
.mtour .row+.row::before{content:'';position:absolute;left:calc(var(--gut) + 41px);right:0;top:0;
  height:1px;background:var(--rule-2)}
.mtour .rows.avatars .row+.row::before{left:calc(var(--gut) + 51px)}
.mtour .rows.flush .row+.row::before{left:var(--gut)}
.mtour .row .glyph{width:28px;flex-shrink:0;color:var(--ink-mute);display:flex;justify-content:center}
.mtour .row .glyph.in{color:var(--signal)}
.mtour .row .glyph.missed{color:var(--danger)}
.mtour .row .mid{flex:1;min-width:0}
.mtour .row .nm{font-size:15px;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtour .row .nm.unread{font-weight:700}
.mtour .row .meta{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-soft);margin-top:3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtour .row .meta .dot{width:2.5px;height:2.5px;border-radius:999px;background:var(--ink-mute);flex-shrink:0}
.mtour .row .rt{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0}
.mtour .row .time{font-size:12.5px;color:var(--ink-mute);font-variant-numeric:tabular-nums}
.mtour .row .chev{color:var(--ink-mute);opacity:.55;flex-shrink:0}
/* initials bubble for contacts */
.mtour .bub{width:38px;height:38px;border-radius:999px;background:var(--paper-3);color:var(--ink-soft);
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;flex-shrink:0}
.mtour .bub.sig-b{background:var(--signal-soft);color:var(--signal)}
/* ============================================================
   Chips, money, buttons
   ============================================================ */
.mtour .chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11.5px;
  border:1px solid var(--rule);background:var(--paper-2);color:var(--ink-soft);white-space:nowrap}
.mtour .chip--in{color:var(--signal);border-color:rgba(26,75,114,.25);background:var(--signal-soft)}
.mtour .chip--missed{color:var(--danger);border-color:rgba(192,57,43,.25);background:rgba(192,57,43,.06)}
.mtour .chip--ok{color:var(--green-ink);border-color:rgba(0,210,138,.35);background:rgba(0,210,138,.1)}
.mtour .chip--warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:color-mix(in srgb,var(--warn) 10%,transparent)}
.mtour .chip .pulse{width:5px;height:5px;border-radius:999px;background:currentColor;animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.35)}}
.mtour .money{font-variant-numeric:tabular-nums;white-space:nowrap}
.mtour .money .c{font-size:.68em;vertical-align:.34em;margin-left:.5px}
.mtour .money .c::before{content:'.';font-size:1.25em;vertical-align:baseline}
.mtour .money.pos{color:var(--green-ink)}
.mtour .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;
  border-radius:999px;font-size:14.5px;font-weight:500;transition:transform .16s var(--motion-ease),background .16s}
.mtour .btn:active{transform:scale(.975)}
.mtour .btn-dark{background:var(--ink);color:var(--paper)}
.mtour .btn-signal{background:var(--signal);color:#fff}
.mtour .btn-ghost{border:1px solid var(--rule);color:var(--ink);background:var(--paper)}
.mtour .btn-block{width:100%}
.mtour .btn:disabled{opacity:.4}
/* action strip under a detail header */
.mtour .acts{display:flex;gap:8px;padding:14px var(--gut) 18px}
.mtour .act{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;padding:13px 4px;
  background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius);
  font-size:11.5px;color:var(--ink-soft);transition:border-color .15s,transform .15s var(--motion-ease)}
.mtour .act:active{transform:scale(.97)}
.mtour .act svg{color:var(--signal)}
/* ============================================================
   Cards, sections, fields
   ============================================================ */
.mtour .sec{margin-top:24px}
.mtour .sec-h{display:flex;align-items:baseline;justify-content:space-between;padding:0 var(--gut) 9px}
.mtour .sec-h .k{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-mute)}
.mtour .sec-h .a{font-size:12.5px;color:var(--signal)}
.mtour .card{background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius);padding:16px}
.mtour .card+.card{margin-top:10px}
.mtour .kv{display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:14px}
.mtour .kv+.kv{border-top:1px solid var(--rule-2)}
.mtour .kv .k{color:var(--ink-soft)}
.mtour .kv .v{font-variant-numeric:tabular-nums}
.mtour .field{margin-bottom:16px}
.mtour .field label{display:block;font-size:13px;margin-bottom:7px}
.mtour .input{width:100%;padding:14px 15px;background:var(--paper);border:1px solid var(--rule);
  border-radius:var(--radius);font-size:16px;outline:none;transition:border-color .15s,box-shadow .15s;font-family:inherit}
.mtour .input:focus{border-color:var(--signal);box-shadow:0 0 0 3px var(--signal-soft)}
.mtour .hint{font-size:12.5px;color:var(--ink-soft);line-height:1.5}
/* OTP */
.mtour .otp{display:flex;gap:9px;margin-bottom:18px}
.mtour .otp i{flex:1;height:60px;border:1px solid var(--rule);border-radius:var(--radius);background:var(--paper);
  display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:23px;
  font-style:normal;font-variant-numeric:tabular-nums}
.mtour .otp i.fill{border-color:var(--signal);background:var(--signal-soft);color:var(--signal)}
.mtour .otp i.caret{border-color:var(--signal);box-shadow:0 0 0 3px var(--signal-soft)}
.mtour .otp i.caret::after{content:'';width:2px;height:26px;background:var(--signal);animation:blink 1.05s steps(1) infinite}
@keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}
/* segmented control */
.mtour .seg{display:flex;gap:4px;padding:3px;background:var(--paper-3);border-radius:999px;margin:0 var(--gut) 4px}
.mtour .seg button{flex:1;padding:8px 0;border-radius:999px;font-size:13px;color:var(--ink-soft);transition:all .18s var(--motion-ease)}
.mtour .seg button.on{background:var(--paper);color:var(--ink);font-weight:500;box-shadow:0 1px 3px rgba(10,10,11,.08)}
/* banner */
.mtour .banner{display:flex;gap:11px;align-items:flex-start;margin:0 var(--gut) 4px;padding:13px 14px;
  border-radius:var(--radius);background:color-mix(in srgb,var(--warn) 9%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent)}
.mtour .banner .t{font-size:13px;font-weight:500;color:var(--warn)}
.mtour .banner .d{font-size:12.5px;color:var(--ink-soft);line-height:1.45;margin-top:2px}
/* ============================================================
   Player + transcript
   ============================================================ */
.mtour .player{background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius);
  padding:14px 16px;display:flex;align-items:center;gap:14px}
.mtour .player .play{width:44px;height:44px;border-radius:999px;background:var(--signal);color:#fff;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .16s var(--motion-ease)}
.mtour .player .play:active{transform:scale(.93)}
.mtour .player .wrap{flex:1;min-width:0}
.mtour .player .times{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10.5px;
  color:var(--ink-mute);margin-top:7px;font-variant-numeric:tabular-nums}
.mtour .tr{padding:0 var(--gut)}
.mtour .trline{display:flex;gap:12px;padding:11px 0;text-align:left;width:100%;transition:opacity .15s}
.mtour .trline+.trline{border-top:1px solid var(--rule-2)}
.mtour .trline .lft{width:66px;flex-shrink:0}
.mtour .trline .who, .mtour .trline .at{display:block}
.mtour .trline .who{font-size:11px;font-weight:500;letter-spacing:.01em}
.mtour .trline .who.them{color:var(--signal)}
.mtour .trline .who.agent{color:var(--green-ink)}
.mtour .trline .at{font-family:var(--font-mono);font-size:10.5px;color:var(--ink-mute);margin-top:2px;
  font-variant-numeric:tabular-nums}
.mtour .trline .txt{font-size:14px;line-height:1.55;color:var(--ink);flex:1}
.mtour .trline.dim .txt{color:var(--ink-mute)}
/* ============================================================
   Dialer
   ============================================================ */
.mtour .dial{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:10px}
.mtour .fromPill{align-self:center;display:inline-flex;align-items:center;gap:8px;padding:7px 14px;
  border:1px solid var(--rule);border-radius:999px;background:var(--paper);font-size:12.5px;color:var(--ink-soft)}
.mtour .fromPill b{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}
.mtour .dialnum{text-align:center;font-family:var(--font-display);font-size:33px;letter-spacing:-.01em;
  font-variant-numeric:tabular-nums;padding:12px 0 6px;min-height:70px}
.mtour .dialnum .ph{color:var(--ink-mute);opacity:.5}
.mtour .dialhint{text-align:center;font-size:12.5px;color:var(--ink-mute);height:18px}
.mtour .pad3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 30px;padding:22px var(--gut) 0;justify-items:center}
.mtour .dkey{width:74px;height:74px;border-radius:999px;background:var(--paper);border:1px solid var(--rule);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  transition:background .12s,transform .12s var(--motion-ease)}
.mtour .dkey:active{background:var(--signal-soft);transform:scale(.94)}
.mtour .dkey .d{font-family:var(--font-display);font-size:27px;line-height:1}
.mtour .dkey .l{font-family:var(--font-mono);font-size:9px;letter-spacing:.16em;color:var(--ink-mute);margin-top:3px;height:11px}
.mtour .dialrow{display:flex;align-items:center;justify-content:center;gap:34px;padding:22px 0 6px}
.mtour .callkey{width:74px;height:74px;border-radius:999px;background:var(--live);color:#04231a;
  display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px -10px rgba(0,210,138,.75);
  transition:transform .16s var(--motion-ease)}
.mtour .callkey:active{transform:scale(.93)}
.mtour .backsp{width:56px;color:var(--ink-soft);display:flex;justify-content:center}
/* ============================================================
   In-call / incoming — the only screens you look at without reading.
   Inverted on purpose.
   ============================================================ */
.mtour .dark-scr .callhd{padding:34px var(--gut) 0;text-align:center}
.mtour .callhd .st{font-family:var(--font-mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;
  color:rgba(243,243,245,.5)}
.mtour .callhd .who{font-family:var(--font-display);font-size:31px;letter-spacing:-.02em;margin-top:14px}
.mtour .callhd .via{font-size:13px;color:rgba(243,243,245,.55);margin-top:8px;font-variant-numeric:tabular-nums}
.mtour .callhd .timer{font-family:var(--font-mono);font-size:15px;color:var(--live);margin-top:12px;
  font-variant-numeric:tabular-nums;letter-spacing:.04em}
.mtour .sigstage{flex:1;display:flex;align-items:center;justify-content:center}
.mtour .sigstage .sig{height:126px;gap:7px}
.mtour .sigstage .sig i{width:5px;border-radius:3px}
.mtour .ctrls{display:grid;grid-template-columns:repeat(3,1fr);gap:22px 12px;padding:0 34px 22px}
.mtour .ctrl{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11.5px;color:rgba(243,243,245,.65)}
.mtour .ctrl .cc{width:66px;height:66px;border-radius:999px;background:rgba(243,243,245,.11);color:#f3f3f5;
  display:flex;align-items:center;justify-content:center;transition:background .15s,transform .14s var(--motion-ease)}
.mtour .ctrl:active .cc{transform:scale(.93)}
.mtour .ctrl.on .cc{background:#f3f3f5;color:#0A0A0B}
.mtour .endrow{display:flex;justify-content:center;padding:6px 0 calc(var(--safe-b) + 14px)}
.mtour .endkey{width:74px;height:74px;border-radius:999px;background:var(--danger);color:#fff;
  display:flex;align-items:center;justify-content:center}
.mtour .endkey svg{transform:rotate(134deg)}
.mtour .answerrow{display:flex;justify-content:space-between;padding:0 52px calc(var(--safe-b) + 18px)}
.mtour .arow-b{display:flex;flex-direction:column;align-items:center;gap:11px;font-size:12px;color:rgba(243,243,245,.6)}
.mtour .ansq{width:76px;height:76px;border-radius:999px;display:flex;align-items:center;justify-content:center}
.mtour .ansq.yes{background:var(--live);color:#04231a;animation:jig 1.6s var(--motion-ease) infinite}
.mtour .ansq.no{background:var(--danger);color:#fff}
@keyframes jig{0%,72%,100%{transform:translateY(0)}80%{transform:translateY(-7px)}88%{transform:translateY(0)}}
.mtour .agentnote{margin:0 34px 22px;padding:12px 14px;border-radius:var(--radius);
  background:rgba(0,210,138,.1);border:1px solid rgba(0,210,138,.3);text-align:center}
.mtour .agentnote .t{font-size:12.5px;color:var(--live)}
.mtour .agentnote .d{font-size:11.5px;color:rgba(243,243,245,.55);margin-top:3px}
/* ============================================================
   Wallet
   ============================================================ */
.mtour .balance{padding:6px var(--gut) 0}
.mtour .balance .amt{font-family:var(--font-display);font-size:44px;letter-spacing:-.03em;line-height:1;
  font-variant-numeric:tabular-nums}
.mtour .balance .sub{font-size:13px;color:var(--ink-soft);margin-top:9px}
.mtour .twoup{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 var(--gut)}
.mtour .stat{background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius);padding:14px 15px}
.mtour .stat .l{font-size:12.5px;color:var(--ink-soft)}
.mtour .stat .v{font-size:21px;letter-spacing:-.02em;margin-top:8px;font-variant-numeric:tabular-nums}
/* sheet */
.mtour .sheetwrap{position:absolute;inset:0;z-index:40;display:none}
.mtour .sheetwrap.on{display:block}
.mtour .sheetwrap .scrim{position:absolute;inset:0;background:rgba(10,10,11,.4);animation:fade .22s}
@keyframes fade{from{opacity:0}to{opacity:1}}
.mtour .sheet{position:absolute;left:0;right:0;bottom:0;background:var(--paper);
  border-radius:var(--sheet-r) var(--sheet-r) 0 0;padding:10px var(--gut) calc(var(--safe-b) + 18px);
  animation:up .3s var(--motion-ease)}
@keyframes up{from{transform:translateY(100%)}to{transform:none}}
.mtour .grab{width:38px;height:4px;border-radius:999px;background:var(--rule);margin:0 auto 16px}
.mtour .sheet h3{font-family:var(--font-display);font-size:20px;letter-spacing:-.02em;margin-bottom:6px}
.mtour .amtgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:16px 0}
.mtour .amtgrid button{padding:15px 0;border:1px solid var(--rule);border-radius:var(--radius);
  font-size:15px;font-variant-numeric:tabular-nums;background:var(--paper)}
.mtour .amtgrid button.on{border-color:var(--signal);background:var(--signal-soft);color:var(--signal);font-weight:500}
/* ---- big copyable figures (virtual account, extensions) ---- */
.mtour .bignum{font-family:var(--font-display);font-size:29px;letter-spacing:.01em;font-variant-numeric:tabular-nums}
.mtour .copyrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mtour .copybtn{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border:1px solid var(--rule);
  border-radius:999px;font-size:12.5px;color:var(--signal);background:var(--paper);flex-shrink:0}
.mtour .copybtn:active{background:var(--signal-soft)}
/* ---- pay-mode switch inside the top-up sheet ---- */
.mtour .modeseg{display:flex;gap:4px;padding:3px;background:var(--paper-3);border-radius:999px;margin-bottom:16px}
.mtour .modeseg button{flex:1;padding:9px 0;border-radius:999px;font-size:13px;color:var(--ink-soft)}
.mtour .modeseg button.on{background:var(--paper);color:var(--ink);font-weight:500;box-shadow:0 1px 3px rgba(10,10,11,.08)}
/* ---- ordered steps (go live) ---- */
.mtour .steps{padding:0 var(--gut)}
.mtour .step{display:flex;gap:13px;padding-bottom:20px;position:relative}
.mtour .step:not(:last-child)::before{content:'';position:absolute;left:11px;top:24px;bottom:-2px;width:1.5px;background:var(--rule)}
.mtour .step.done:not(:last-child)::before{background:var(--live)}
.mtour .step .dot{width:23px;height:23px;border-radius:50%;flex-shrink:0;z-index:1;display:flex;align-items:center;
  justify-content:center;border:1.5px solid var(--rule);background:var(--paper);color:var(--ink-mute);font-size:11px}
.mtour .step.done .dot{border-color:var(--live);color:var(--green-ink)}
.mtour .step.now .dot{border-color:var(--signal);color:var(--signal);box-shadow:0 0 0 3px var(--signal-soft)}
.mtour .step .t{font-size:15px;letter-spacing:-.005em}
.mtour .step .d{font-size:12.5px;color:var(--ink-soft);line-height:1.5;margin-top:3px}
/* ---- toast ---- */
.mtour .toast{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--tab-h) + var(--safe-b) + 16px);
  background:var(--ink);color:var(--paper);padding:11px 17px;border-radius:999px;font-size:13px;z-index:60;
  animation:toastin .22s var(--motion-ease);white-space:nowrap;box-shadow:0 12px 30px -12px rgba(10,10,11,.5)}
@keyframes toastin{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
/* settings list */
.mtour .slist{background:var(--paper);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.mtour .sitem{display:flex;align-items:center;gap:12px;width:100%;padding:15px var(--gut);text-align:left;position:relative}
.mtour .sitem+.sitem::before{content:'';position:absolute;left:var(--gut);right:0;top:0;height:1px;background:var(--rule-2)}
.mtour .sitem .l{flex:1;font-size:15px}
.mtour .sitem .r{font-size:13.5px;color:var(--ink-mute);display:inline-flex;align-items:center;gap:5px}
.mtour .sitem.danger .l{color:var(--danger)}
.mtour .empty{text-align:center;padding:56px 34px}
.mtour .empty h3{font-family:var(--font-display);font-size:19px;margin-bottom:8px}
.mtour .empty p{font-size:13.5px;color:var(--ink-soft);line-height:1.55}

@media (max-width:900px){
.mtour .stage{flex-direction:column;align-items:center;padding:24px 12px}
.mtour .rail{position:static;width:100%;max-width:390px}
.mtour .phone{transform:scale(.92);transform-origin:top center}
}
/* Home: alerts, a three-up figure row, and today's line. */
.mtour .alert{display:flex;align-items:center;gap:11px;width:100%;border:0;cursor:pointer;
  border-radius:12px;padding:13px 14px;margin-bottom:9px;text-align:left;font:inherit}
.mtour .alert-bad{background:color-mix(in srgb,var(--danger) 9%,transparent);color:var(--danger)}
.mtour .alert-warn{background:color-mix(in srgb,var(--warn) 11%,transparent);color:var(--warn)}
.mtour .alert .ai{display:flex}
.mtour .alert .at{flex:1;color:var(--ink);font-size:14.5px}
.mtour .alert .aa{font-size:12.5px;color:inherit}
.mtour .threeup{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.mtour .threeup .stat .v{font:600 21px/1 var(--font-display);color:var(--ink)}
.mtour .threeup .stat .l{font-size:12px;color:var(--ink-soft);margin-top:4px}
.mtour .spark{margin-top:18px}
.mtour .spark svg{width:100%;height:64px;display:block}
.mtour .sparkx{display:flex;justify-content:space-between;margin-top:7px;
  font-size:10px;letter-spacing:.06em;color:var(--ink-mute)}
/* The rail as a menu. Children were marked with an em-dash, which reads as a
   flat list of oddly-named items rather than a hierarchy; indentation and a
   rule do the same job without pretending to be part of the name. */
.mtour .rail .menu{display:flex;flex-direction:column}
.mtour .rail button.nav.kid{margin-left:10px;padding-left:13px;
  border-left:1px solid var(--rule);border-radius:0 8px 8px 0}
.mtour .rail button.nav.kid.on{border-left-color:var(--signal)}
@media (max-width:900px){
/* On a phone the rail is above the phone, so a 20-item column pushes the
     thing being demonstrated off the screen. A scrolling strip keeps both
     visible and is the pattern people already know from tab bars. */
.mtour .rail .sub{display:none}
.mtour .rail .menu{flex-direction:row;overflow-x:auto;gap:7px;padding:2px 0 10px;
    -webkit-overflow-scrolling:touch;scrollbar-width:none}
.mtour .rail .menu::-webkit-scrollbar{display:none}
.mtour .rail .grp{display:none}
.mtour .rail button.nav, .mtour .rail button.nav.kid{margin:0;white-space:nowrap;flex:0 0 auto;
    border:1px solid var(--rule);border-radius:999px;padding:8px 14px}
.mtour .rail button.nav.on{border-color:var(--signal)}
}


.mtour { width: 100%; max-width: 1180px; }
.mtour .mt-top { display: flex; align-items: center; gap: 12px; padding-bottom: 16px;
  margin-bottom: 22px; border-bottom: 1px solid var(--rule); }
.mtour .mt-title { font-size: 12.5px; color: var(--ink-mute); }
.mtour .mt-sp { flex: 1; }
.mtour .mt-signin { font-size: 12.5px; font-weight: 600; color: var(--signal);
  text-decoration: none; padding: 6px 14px; border-radius: 999px;
  background: var(--signal-soft); }
.mtour .mt-me { position: relative; cursor: pointer; }
.mtour .mt-av { width: 28px; height: 28px; border-radius: 50%; background: var(--signal);
  color: #fff; font-size: 11px; font-weight: 600; display: flex; align-items: center;
  justify-content: center; }
.mtour .mt-menu { position: absolute; right: 0; top: 36px; min-width: 190px; z-index: 40;
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 5px; box-shadow: 0 12px 30px -10px rgba(10,10,11,.2); }
.mtour .mt-mi { display: block; font-size: 12.5px; color: var(--ink);
  text-decoration: none; padding: 8px 11px; border-radius: 7px; }
.mtour .mt-mi:hover { background: var(--paper-3); }
.mtour .mt-sidelink { display: block; margin-top: 20px; padding-top: 16px;
  border-top: 1px solid var(--rule); font-size: 12.5px; font-weight: 600;
  color: var(--signal); text-decoration: none; }
.mtour .mt-railtoggle { display: none; }

@media (max-width: 900px) {
  .mtour .mt-railtoggle { display: flex; align-items: center; justify-content: space-between;
    width: 100%; gap: 12px; padding: 12px 15px; margin-bottom: 14px;
    border: 1px solid var(--rule); border-radius: var(--radius); background: var(--paper);
    font-size: 13.5px; font-weight: 600; text-align: left; cursor: pointer; }
  .mtour .mt-caret { color: var(--ink-mute); font-size: 11px; transition: transform .2s; }
  .mtour .mt-caret.up { transform: rotate(180deg); }
  .mtour .rail { display: none; }
  .mtour .rail.open { display: block; }
}

.mtour .notes{width:330px;flex-shrink:0;position:sticky;top:40px;font-family:var(--font-sans);color:var(--ink)}
.mtour .notes h2{font:600 22px/1.25 var(--font-display);margin:0 0 10px;letter-spacing:-.015em}
.mtour .nkick{font:600 10px/1 var(--font-sans);letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-mute);margin:0 0 10px}
.mtour .nlede{margin:0 0 18px;color:var(--ink-soft);font-size:15px;line-height:1.55}
.mtour ol.ndo{margin:0 0 18px;padding:0;list-style:none;counter-reset:s}
.mtour ol.ndo li{counter-increment:s;position:relative;padding-left:31px;margin-bottom:9px;font-size:14px;line-height:1.5}
.mtour ol.ndo li::before{content:counter(s);position:absolute;left:0;top:0;width:21px;height:21px;border-radius:50%;
  background:var(--paper-3);color:var(--ink-soft);font:600 11px/21px var(--font-sans);text-align:center}
.mtour .nwatch{border-left:3px solid var(--warn);background:var(--paper);border-radius:0 10px 10px 0;
  padding:12px 14px;margin-bottom:16px}
.mtour .nwatch h5{font:600 10px/1 var(--font-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--warn);margin:0 0 6px}
.mtour .nwatch p{margin:0;font-size:13.5px;line-height:1.5;color:var(--ink-soft)}
.mtour ul.nwhy{list-style:none;margin:0;padding:0}
.mtour ul.nwhy li{position:relative;padding-left:22px;margin-bottom:6px;font-size:13.5px;color:var(--ink-soft);line-height:1.5}
.mtour ul.nwhy li::before{content:"";position:absolute;left:4px;top:7px;width:6px;height:6px;border-radius:50%;background:var(--green-ink)}
@media (max-width:1100px){
.mtour .notes{position:static;width:100%;max-width:390px;margin-top:6px}}

</style>
