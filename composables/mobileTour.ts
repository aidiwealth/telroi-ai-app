/**
 * The mobile walkthrough, ported from the standalone prototype with only its
 * reach into the document changed: it works against the page's own root.
 */
export interface MobileTour {
  render: (name: string) => void;
  onClick: (e: Event) => void;
  views: string[];
}

export function mountMobileTour(root: HTMLElement): MobileTour {

  /* ============================================================
     Telroi Mobile — prototype behaviour.
     Screens are rendered from data so the markup stays honest about
     what the API actually returns.
     ============================================================ */
  const S = (d, w = 20, extra = '') =>
    `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  const I = {
    home: (w = 20) => S('<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-6v6H4.5a1 1 0 0 1-1-1z"/>', w),
    phone:    d => S('<path d="M6.5 3h3l1.5 4-2 1.4a12 12 0 0 0 6.6 6.6L17 13l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 7.2 2 2 0 0 1 6.5 3z"/>', d),
    arrowIn:  d => S('<path d="M20 4 11 13"/><path d="M11 7v6h6"/><path d="M4 15v3a2 2 0 0 0 2.2 2 13 13 0 0 0 5-1.6"/>', d),
    arrowOut: d => S('<path d="M12 12 21 3"/><path d="M21 9V3h-6"/><path d="M4 15v3a2 2 0 0 0 2.2 2 13 13 0 0 0 5-1.6"/>', d),
    missed:   d => S('<path d="M20 4 11 13"/><path d="M11 7v6h6"/><path d="M4 15v3a2 2 0 0 0 2.2 2 13 13 0 0 0 5-1.6"/>', d),
    person:   d => S('<circle cx="12" cy="8" r="3.4"/><path d="M4.6 20a7.6 7.6 0 0 1 14.8 0"/>', d),
    wallet:   d => S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H17a2 2 0 0 1 2 2v1"/><rect x="3" y="8" width="18" height="11" rx="2.5"/><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none"/>', d),
    gear:     d => S('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"/>', d),
    grid:     d => S('<circle cx="6" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="18" r="1.4" fill="currentColor" stroke="none"/>', d),
    chev:     d => S('<path d="M9 5.5 15.5 12 9 18.5"/>', d),
    back:     d => S('<path d="M14.5 5 8 12l6.5 7"/>', d),
    play:     d => S('<path d="M8 5.5 18.5 12 8 18.5z" fill="currentColor" stroke="none"/>', d),
    pause:    d => S('<rect x="8" y="5.5" width="3" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="3" height="13" rx="1" fill="currentColor" stroke="none"/>', d),
    mic:      d => S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>', d),
    micOff:   d => S('<path d="M4 4l16 16"/><path d="M15 5a3 3 0 0 0-6 0v5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 9.9 5.6"/><path d="M12 18v3"/>', d),
    speaker:  d => S('<path d="M4 9.5h3L12 5v14l-5-4.5H4z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8"/>', d),
    plus:     d => S('<path d="M12 5v14M5 12h14"/>', d),
    pause2:   d => S('<rect x="7" y="5" width="4" height="14" rx="1.2"/><rect x="13" y="5" width="4" height="14" rx="1.2"/>', d),
    search:   d => S('<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6 20 20"/>', d),
    x:        d => S('<path d="M6 6l12 12M18 6 6 18"/>', d),
    note:     d => S('<path d="M6 3.5h9L19 8v12.5H6z"/><path d="M14.5 3.6V8H19"/><path d="M9 12h7M9 16h5"/>', d),
    lines:    d => S('<path d="M4 7h11M4 12h16M4 17h8"/>', d),
    backsp:   d => S('<path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12 10l4 4M16 10l-4 4"/>', d),
    shield:   d => S('<path d="M12 3 5 6v5.5c0 4.3 2.9 7.7 7 9.5 4.1-1.8 7-5.2 7-9.5V6z"/><path d="M9.2 12.2 11.4 14.4 15 10.6"/>', d),
    star:     d => S('<path d="m12 4 2.5 5 5.5.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9L9.5 9z"/>', d),
    bolt:     d => S('<path d="M13 3 5.5 13.5H11L10.5 21 18.5 10H13z"/>', d),
    hold:     d => S('<circle cx="12" cy="12" r="8.5"/><path d="M10 9.5v5M14 9.5v5"/>', d),
    add:      d => S('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.8 5.8 0 0 1 11 0"/><path d="M18 8.5v5M15.5 11h5"/>', d),
    copy:     d => S('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5H6a1.5 1.5 0 0 0-1.5 1.5v9.5"/>', d),
  };

  /* ---------- demo data (shapes follow the API in the brief) ---------- */
  const WS = { name: 'Bloom Interiors', slug: 'bloom', sandbox: true, role: 'owner', currency: '₦' };

  const CALLS = [
    { id:'c1', day:'Today', name:'Adaeze Okafor', number:'+234 803 220 4417', dir:'in', at:'4:32 PM',
      dur:'6m 12s', rec:true, transcript:true, unread:true, tags:['Customer'] },
    { id:'c2', day:'Today', name:'+234 803 411 9088', number:'+234 803 411 9088', dir:'missed', at:'3:58 PM',
      dur:'1m 04s', rec:true, transcript:true, agent:true, unread:true },
    { id:'c3', day:'Today', name:'Tunde Bakare', number:'+234 701 559 0021', dir:'out', at:'2:14 PM',
      dur:'2m 47s', rec:true },
    { id:'c4', day:'Today', name:'+234 1 448 2210', number:'+234 1 448 2210', dir:'in', at:'11:02 AM', dur:'44s' },
    { id:'c5', day:'Yesterday', name:'Ngozi Eze', number:'+234 809 771 3300', dir:'out', at:'5:41 PM',
      dur:'12m 03s', rec:true, transcript:true },
    { id:'c6', day:'Yesterday', name:'+1 415 555 0138', number:'+1 415 555 0138', dir:'missed', at:'4:12 PM',
      dur:'Rang out' },
    { id:'c7', day:'Yesterday', name:'Salim Yusuf', number:'+234 802 010 7745', dir:'in', at:'9:30 AM', dur:'3m 21s', rec:true },
  ];

  const CONTACTS = [
    { n:'Adaeze Okafor', ph:'+234 803 220 4417', st:'Customer', calls:9, last:'Today' },
    { n:'Chidi Nwosu',   ph:'+234 806 442 1180', st:'Lead',     calls:2, last:'3 days ago' },
    { n:'Ngozi Eze',     ph:'+234 809 771 3300', st:'Customer', calls:14, last:'Yesterday' },
    { n:'Salim Yusuf',   ph:'+234 802 010 7745', st:'Lead',     calls:1, last:'Yesterday' },
    { n:'Tunde Bakare',  ph:'+234 701 559 0021', st:'Supplier', calls:6, last:'Today' },
  ];

  const LEDGER = [
    { t:'Top-up · Paystack',      d:'Today, 9:14 AM',     a:'+50,000', c:'00', pos:true },
    { t:'Calls · 24 Aug',         d:'Today',              a:'−1,240',  c:'55' },
    { t:'Transcription · 2 files',d:'Today',              a:'−96',     c:'00' },
    { t:'Number rental · 1 line', d:'23 Aug',             a:'−2,500',  c:'00' },
    { t:'Growth plan · monthly',  d:'1 Aug',              a:'−18,000', c:'00' },
  ];

  const NUMBERS = [
    { n:'+234 1 888 0042', label:'Main line', place:'Lagos · landline', carrier:'Sotel',
      monthly:'₦2,500', st:'active', rec:true, route:'Everyone, then the agent', mins:'412 min this month' },
    { n:'+234 703 900 1188', label:'Sales', place:'Nigeria · mobile', carrier:'Ruach',
      monthly:'₦3,200', st:'active', rec:false, route:'Sales group only', mins:'96 min this month' },
    { n:'+1 415 200 7788', label:'US line', place:'San Francisco · landline', carrier:'Telnyx',
      monthly:'$4.00', st:'indemnity', rec:false, route:'Not routed yet', mins:'Not in use' },
  ];

  const TEAM = [
    { n:'Emmanuel Gbolade', e:'ade@bloominteriors.ng', role:'Owner',  ext:'101', you:true },
    { n:'Adunni Bello',     e:'adunni@bloominteriors.ng', role:'Admin',  ext:'102' },
    { n:'Chike Obi',        e:'chike@bloominteriors.ng',  role:'Member', ext:'103' },
    { n:'Fatima Sani',      e:'fatima@bloominteriors.ng', role:'Member', ext:'—', pending:true },
  ];

  // GET /api/wallet/account — the reserved account Monnify issues per workspace.
  const VACCT = {
    accountName: 'TELROI / BLOOM INTERIORS',
    accounts: [
      { bankName: 'Wema Bank',     accountNumber: '7050118442' },
      { bankName: 'Sterling Bank', accountNumber: '8123990771' },
    ],
  };

  const TRANSCRIPT = [
    { w:'Agent',  cls:'agent', at:'0:00', t:'Good afternoon, Bloom Interiors. Nobody is free right now — can I take a message?' },
    { w:'Adaeze', cls:'them',  at:'0:06', t:"Yes please. I'm calling about the sofa I ordered on the fourteenth, the grey three-seater." },
    { w:'Agent',  cls:'agent', at:'0:14', t:'I have that order. It left the workshop on Friday and is with the courier.' },
    { w:'Adaeze', cls:'them',  at:'0:21', t:'Do you know which day it lands? I need somebody at the house.' },
    { w:'You',    cls:'',      at:'0:29', t:'Adaeze, sorry — I just came free. It is out for delivery Thursday, between ten and two.' },
    { w:'Adaeze', cls:'them',  at:'0:38', t:'Thursday works. Can the driver call this number first?' },
    { w:'You',    cls:'',      at:'0:44', t:"I'll put it on the docket. Anything else on the order?" },
    { w:'Adaeze', cls:'them',  at:'0:51', t:'No, that was all. Thank you.' },
  ];

  /* ---------- helpers ---------- */
  function bars(seed, n, cls = '') {
    let s = seed, out = '';
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const h = 18 + (s % 82);
      out += `<i style="height:${h}%"${cls ? ` class="${cls}"` : ''}></i>`;
    }
    return out;
  }
  function sigRow(seed) { return `<span class="sig">${bars(seed, 16)}</span>`; }
  function money(whole, cents, cls = '') {
    return `<span class="money ${cls}">${whole}<span class="c">${cents}</span></span>`;
  }
  const sbar = () => `<div class="sbar"><span>9:41</span>
    <span class="rt">${S('<path d="M2 13h2v5H2zM7 9h2v9H7zM12 5h2v13h-2zM17 8h2v10h-2z" fill="currentColor" stroke="none"/>', 15)}
    ${S('<rect x="2" y="7" width="17" height="10" rx="2.5"/><rect x="4" y="9" width="12" height="6" rx="1" fill="currentColor" stroke="none"/><path d="M21 10.5v3"/>', 17)}</span></div>`;

  function tabs(active) {
    const t = (id, ic, lbl) =>
      `<button class="tab ${active === id ? 'on' : ''}" data-go="${id}">${I[ic](21)}<span class="lbl">${lbl}</span></button>`;
    return `<nav class="tabs">
      ${t('home', 'home', 'Home')}
      ${t('calls', 'phone', 'Calls')}
      <button class="tab dialkey" data-go="dialer"><span class="key">${I.grid(22)}</span></button>
      ${t('wallet', 'wallet', 'Wallet')}
      ${t('settings', 'gear', 'Settings')}
    </nav>`;
  }
  function bigHead(title, right = '') {
    return `<header class="hdr">
      <div class="toprow">
        <button class="wspill" data-go="settings">${WS.name}<span class="cv">${I.chev(14)}</span></button>
        <div class="spacer"></div>
        ${WS.sandbox ? '<button class="envdot" data-go="settings"><span class="pulse"></span>Sandbox</button>' : ''}
        <button class="avatar" data-go="settings" style="width:30px;height:30px;font-size:11.5px">EG</button>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
        <h2 class="big">${title}</h2>${right}</div></header>`;
  }
  function backHead(title, sub = '', right = '') {
    return `<header class="hdr compact">
      <button class="iconbtn" data-back="1">${I.back(21)}</button>
      <div><div class="ttl">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <div class="spacer"></div>${right}</header>`;
  }

  /* ============================================================
     Screens
     ============================================================ */
  const VIEWS = {};

  /* ---------- Sign in ---------- */
  const R2 = 'https://pub-f138f42d66b748108ebf7432c7314665.r2.dev';
  const OPENER_VIDEO = `${R2}/iStock-2180538267.mp4`;
  const LOGO_WORDMARK = `${R2}/telroi-ll.png`;   // full lockup, as the web app's bare layout uses
  const LOGO_MARK     = `${R2}/telroi-v1%20logo.png`;  // glyph only, for tight spaces

  VIEWS.signin = () => `<div class="over">
    <video autoplay muted loop playsinline preload="auto" src="${OPENER_VIDEO}"></video>
    <div class="scrim"></div>
    <div class="inner">
      ${sbar()}
      <div class="brandmark">
        <img src="${LOGO_WORDMARK}" alt="Telroi" class="wordmark on-dark">
      </div>
      <div class="overcopy">
        <h2>Your numbers,<br>in your pocket.</h2>
        <p>Take the call, make the call, and know what was said — on the line your business already answers.</p>
      </div>
      <div class="signsheet">
        <div class="field">
          <label for="em">Work email</label>
          <input class="input" id="em" type="email" inputmode="email" value="ade@bloominteriors.ng" autocomplete="email">
        </div>
        <button class="btn btn-dark btn-block" data-go="otp">Send me a code</button>
        <p class="hint" style="margin-top:14px;text-align:center">
          We send a six-digit code. There is no password to remember.</p>
      </div>
    </div>
  </div>`;

  /* ---------- OTP ---------- */
  VIEWS.otp = () => `${sbar()}
    ${backHead('Enter code', 'Sent to ade@bloominteriors.ng',
      `<img src="${LOGO_MARK}" alt="" class="markglyph">`)}
    <div class="body pad" style="padding-top:30px">
      <div class="otp" id="otpboxes">
        <i class="fill">4</i><i class="fill">1</i><i class="fill">7</i><i class="caret"></i><i></i><i></i>
      </div>
      <p class="hint">Six digits, good for ten minutes. Wrong three times and the code dies — ask for a fresh one.</p>
      <button class="btn btn-dark btn-block" style="margin-top:26px" data-go="calls">Continue</button>
      <button class="btn btn-ghost btn-block" style="margin-top:10px">Send it again</button>
    </div>`;

  /* ---------- Call history ---------- */
  function callRow(c) {
    const glyph = c.dir === 'in' ? `<span class="glyph in">${I.arrowIn(19)}</span>`
      : c.dir === 'out' ? `<span class="glyph">${I.arrowOut(19)}</span>`
      : `<span class="glyph missed">${I.missed(19)}</span>`;
    const meta = [];
    if (c.agent) meta.push(`<span style="color:var(--green-ink)">Agent answered</span>`);
    meta.push(c.dur);
    if (c.tags) meta.push(c.tags[0]);
    return `<button class="row" data-go="detail">
      ${glyph}
      <div class="mid">
        <div class="nm ${c.unread ? 'unread' : ''}">${c.name}</div>
        <div class="meta">${meta.map((m, i) => (i ? `<span class="dot"></span>${m}` : m)).join('')}</div>
      </div>
      <div class="rt">
        <span class="time">${c.at}</span>
        ${c.rec ? sigRow(c.id.charCodeAt(1) * 31) : ''}
      </div>
      <span class="chev">${I.chev(17)}</span>
    </button>`;
  }
  VIEWS.calls = () => {
    let out = '', day = '';
    CALLS.forEach(c => {
      if (c.day !== day) { out += (day ? '</div>' : '') + `<div class="daylabel">${c.day}</div><div class="rows">`; day = c.day; }
      out += callRow(c);
    });
    out += '</div>';
    return `${sbar()}
      ${bigHead('Calls')}
      <div class="seg" id="callseg">
        <button class="on">All</button><button>Missed</button><button>Recorded</button>
      </div>
      <div class="body">
        ${out}
      </div>`;
  };

  /* ---------- Call detail ---------- */
  VIEWS.detail = () => `${sbar()}
    ${backHead('Adaeze Okafor', '+234 803 220 4417',
      `<button class="iconbtn">${I.person(20)}</button>`)}
    <div class="body">
      <div style="padding:20px var(--gut) 0">
        <div style="display:flex;align-items:center;gap:7px;color:var(--ink-soft);font-size:13px">
          <span style="color:var(--signal);display:flex">${I.arrowIn(15)}</span>
          Incoming<span class="dot" style="width:2.5px;height:2.5px;border-radius:999px;background:var(--ink-mute)"></span>
          Today, 4:32 PM<span class="dot" style="width:2.5px;height:2.5px;border-radius:999px;background:var(--ink-mute)"></span>6m 12s
        </div>
        <div style="margin-top:11px"><span class="chip chip--ok">Agent picked up, you took over at 0:29</span></div>
      </div>
      <div class="acts">
        <button class="act" data-go="incall">${I.phone(19)}Call back</button>
        <button class="act">${I.note(19)}Add note</button>
        <button class="act">${I.star(19)}Rate</button>
        <button class="act">${I.copy(19)}Share</button>
      </div>
      <div class="pad">
        <div class="player">
          <button class="play" id="playbtn">${I.play(19)}</button>
          <div class="wrap">
            <span class="sig lg" id="wave">${bars(91, 46)}</span>
            <div class="times"><span id="tnow">0:29</span><span>6:12</span></div>
          </div>
        </div>
      </div>
      <div class="sec">
        <div class="sec-h"><span class="k">Transcript</span><span class="a">English · auto</span></div>
        <div class="tr">
          ${TRANSCRIPT.map(l => `<button class="trline">
            <span class="lft"><span class="who ${l.cls}">${l.w}</span><span class="at">${l.at}</span></span>
            <span class="txt">${l.t}</span></button>`).join('')}
        </div>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">What this call cost</span></div>
        <div class="pad"><div class="card" style="padding:4px 16px">
          <div class="kv"><span class="k">Inbound minutes</span><span class="v">${money('₦74', '40')}</span></div>
          <div class="kv"><span class="k">Transcription</span><span class="v">${money('₦48', '00')}</span></div>
          <div class="kv"><span class="k">Agent handling</span><span class="v">${money('₦12', '00')}</span></div>
        </div></div>
      </div>
    </div>`;

  /* ---------- Contacts ---------- */
  VIEWS.contacts = () => `${sbar()}
    ${bigHead('Contacts', `<button class="iconbtn">${I.search(21)}</button>`)}
    <div class="body">
      <div class="pad" style="padding-top:4px">
        <p class="hint">People appear here on their own, from calls in and out. You rarely have to add anybody.</p>
      </div>
      <div class="daylabel">5 people</div>
      <div class="rows avatars">
        ${CONTACTS.map(c => `<button class="row" data-go="contactDetail">
          <span class="bub ${c.st === 'Customer' ? 'sig-b' : ''}">${c.n.split(' ').map(x => x[0]).join('')}</span>
          <div class="mid"><div class="nm">${c.n}</div>
            <div class="meta">${c.st}<span class="dot"></span>${c.calls} calls<span class="dot"></span>${c.last}</div></div>
          <span class="chev">${I.chev(17)}</span></button>`).join('')}
      </div>
    </div>`;

  /* ---------- Dialer ---------- */
  let DIGITS = '803 220 44';
  const KEYS = [['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],
                ['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
  VIEWS.dialer = () => `${sbar()}
    <div style="display:flex;justify-content:center;padding:2px var(--gut) 0">
      <button class="fromPill" data-sheet="numbers">Calling from <b>+234 1 888 0042</b> ${I.chev(13)}</button>
    </div>
    <div class="dial">
      <div class="dialnum">${DIGITS ? '+234 ' + DIGITS : '<span class="ph">Enter a number</span>'}</div>
      <div class="dialhint">${DIGITS.length > 6 ? 'Adaeze Okafor' : ''}</div>
      <div class="pad3">
        ${KEYS.map(([d, l]) => `<button class="dkey" data-key="${d}"><span class="d">${d}</span><span class="l">${l}</span></button>`).join('')}
      </div>
      <div class="dialrow">
        <span class="backsp"></span>
        <button class="callkey" data-go="incall">${I.phone(28)}</button>
        <button class="backsp" data-key="del">${I.backsp(24)}</button>
      </div>
    </div>`;

  /* ---------- Incoming ---------- */
  VIEWS.incoming = () => `${sbar()}
    <div class="callhd">
      <div class="st">Incoming · Telroi</div>
      <div class="who">Adaeze Okafor</div>
      <div class="via">+234 803 220 4417 → +234 1 888 0042</div>
    </div>
    <div class="sigstage"><span class="sig live">${bars(51, 21)}</span></div>
    <div class="agentnote">
      <div class="t">The agent picks up in 18 seconds</div>
      <div class="d">Answer before then and it stands down.</div>
    </div>
    <div class="answerrow">
      <div class="arow-b"><button class="ansq no" data-go="calls">${I.x(30)}</button>Decline</div>
      <div class="arow-b"><button class="ansq yes" data-go="incall">${I.phone(30)}</button>Answer</div>
    </div>`;

  /* ---------- In call ---------- */
  let MUTED = false, SPK = false;
  VIEWS.incall = () => `${sbar()}
    <div class="callhd">
      <div class="st">On a call</div>
      <div class="who">Adaeze Okafor</div>
      <div class="via">via +234 1 888 0042 · Sotel</div>
      <div class="timer" id="timer">00:42</div>
      <div style="margin-top:14px"><span class="chip" style="background:rgba(0,210,138,.1);border-color:rgba(0,210,138,.3);color:var(--live)"><span class="pulse"></span>Recording · transcript when you hang up</span></div>
    </div>
    <div class="sigstage"><span class="sig live">${bars(23, 21)}</span></div>
    <div class="ctrls">
      <button class="ctrl ${MUTED ? 'on' : ''}" data-tog="mute"><span class="cc">${MUTED ? I.micOff(25) : I.mic(25)}</span>${MUTED ? 'Unmute' : 'Mute'}</button>
      <button class="ctrl" data-go="dialer"><span class="cc">${I.grid(25)}</span>Keypad</button>
      <button class="ctrl ${SPK ? 'on' : ''}" data-tog="spk"><span class="cc">${I.speaker(25)}</span>Speaker</button>
      <button class="ctrl"><span class="cc">${I.add(25)}</span>Add</button>
      <button class="ctrl"><span class="cc">${I.hold(25)}</span>Hold</button>
      <button class="ctrl"><span class="cc">${I.lines(25)}</span>Notes</button>
    </div>
    <div class="endrow"><button class="endkey" data-go="detail">${I.phone(28)}</button></div>`;

  /* ---------- Wallet ---------- */
  VIEWS.wallet = () => `${sbar()}
    ${bigHead('Wallet')}
    <div class="body">
      <div class="balance">
        <div class="amt">${money('₦48,163', '45')}</div>
        <div class="sub">Nigerian naira · about 9 hours of local calls at your rate.</div>
        <div style="display:flex;gap:9px;margin:20px 0 4px">
          <button class="btn btn-dark" style="flex:1" data-sheet="topup">${I.plus(18)} Top up</button>
          <button class="btn btn-ghost" style="flex:1">Auto top-up</button>
        </div>
      </div>
      <div class="sec"><div class="twoup">
        <div class="stat"><div class="l">In this month</div><div class="v">${money('₦150,000', '00', 'pos')}</div></div>
        <div class="stat"><div class="l">Out this month</div><div class="v">${money('₦101,836', '55')}</div></div>
      </div></div>
      <div class="sec">
        <div class="sec-h"><span class="k">Recent movement</span><button class="a" data-go="statement">See all</button></div>
        <div class="rows flush">
          ${LEDGER.map(l => `<button class="row" style="min-height:62px" data-go="txn">
            <div class="mid" style="margin-left:-2px"><div class="nm" style="font-size:14.5px">${l.t}</div>
            <div class="meta">${l.d}</div></div>
            <div class="rt"><span style="font-size:15px">${money(l.a, l.c, l.pos ? 'pos' : '')}</span></div>
            <span class="chev">${I.chev(16)}</span>
          </button>`).join('')}
        </div>
      </div>
      <div class="pad"><p class="hint" style="margin-top:16px">Top-ups clear through Paystack and land in a moment or two. We open their page rather than asking for your card here.</p></div>
    </div>`;


  /* ---------- Home ---------- */
  /* Built after the rest: the three questions somebody opens a phone to answer —
     did I miss anything, do I have money, who do I need to call back. A trend
     chart answers none of them, so today gets a small line and the space goes to
     things you can act on. */
  VIEWS.home = () => `${sbar()}
    ${bigHead('Hi, Emmanuel')}
    <div class="body">
      <div class="pad">
        <button class="alert alert-bad" data-go="calls">
          <span class="ai">${I.missed(18)}</span>
          <span class="at">2 missed calls today</span>
          <span class="aa">See them</span>
        </button>
        <button class="alert alert-warn" data-go="wallet">
          <span class="ai">${I.bolt(18)}</span>
          <span class="at">Balance is running low</span>
          <span class="aa">Top up</span>
        </button>
      </div>

      <div class="pad">
        <div class="card">
          <div style="font-size:12.5px;color:var(--ink-soft)">Balance</div>
          <div class="amt" style="margin-top:6px">${money('₦48,163', '45')}</div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin-top:5px">About 9 hours of calls</div>
          <div style="display:flex;gap:9px;margin-top:16px">
            <button class="btn btn-dark" style="flex:1" data-go="wallet">${I.plus(17)} Top up</button>
            <button class="btn btn-ghost" style="flex:1" data-go="contacts">Contacts</button>
          </div>
        </div>
      </div>

      <div class="sec"><div class="sec-h"><span class="k">Today</span></div>
        <div class="pad" style="padding-top:0">
          <div class="card">
            <div class="threeup">
              <div class="stat"><div class="v">7</div><div class="l">In</div></div>
              <div class="stat"><div class="v">4</div><div class="l">Out</div></div>
              <div class="stat"><div class="v">21m</div><div class="l">Talked</div></div>
            </div>
            <div class="spark">
              <svg viewBox="0 0 320 64" preserveAspectRatio="none" aria-hidden="true">
                <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="var(--signal-bright)" stop-opacity=".24"/>
                  <stop offset="1" stop-color="var(--signal-bright)" stop-opacity="0"/>
                </linearGradient></defs>
                <path d="M0 58 L0 56 Q29 54 58 44 Q87 34 116 39 Q145 44 174 20 Q203 6 232 26 Q261 44 290 38 Q305 35 320 42 L320 64 L0 64 Z" fill="url(#sg)"/>
                <path d="M0 56 Q29 54 58 44 Q87 34 116 39 Q145 44 174 20 Q203 6 232 26 Q261 44 290 38 Q305 35 320 42"
                      fill="none" stroke="var(--signal)" stroke-width="2" stroke-linecap="round"/>
                <circle cx="174" cy="20" r="4.5" fill="var(--paper)"/>
                <circle cx="174" cy="20" r="3" fill="var(--signal)"/>
              </svg>
              <div class="sparkx"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-h"><span class="k">Recent calls</span><button class="a" data-go="calls">See all</button></div>
        <div class="rows flush">
          ${CALLS.slice(0, 4).map(c => `<button class="row" style="min-height:62px" data-go="detail">
            <span class="ic ${c.missed ? 'bad' : c.dir === 'in' ? 'sig' : 'mute'}">${c.missed ? I.missed(17) : I.phone(17)}</span>
            <div class="mid"><div class="nm">${c.who}</div><div class="meta">${c.missed ? 'Missed' : c.len}</div></div>
            <div class="rt"><span class="tm">${c.when}</span></div>
          </button>`).join('')}
        </div>
      </div>
      <div style="height:26px"></div>
    </div>`;


  /* ---------- Buy a number ---------- */
  VIEWS.buynumber = () => `${sbar()}
    ${bigHead('Buy a number', `<button class="hbtn" data-go="numbers">${I.x(18)}</button>`)}
    <div class="body">
      <div class="pad"><p class="hint">The first month is ₦18,500 — the number and one channel — taken from your wallet. Each extra channel is one more call at the same time.</p></div>
      <div class="sec"><div class="sec-h"><span class="k">Available</span></div>
        <div class="pad" style="padding-top:0">
          ${[['+234 1 888 0142','Lagos'],['+234 1 888 0143','Lagos'],['+234 9 291 0077','Abuja']]
            .map(([n, city], i) => `<div class="card" style="margin-bottom:9px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="flex:1">
                  <div style="font-size:16px;font-variant-numeric:tabular-nums">${n}</div>
                  <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px">${city}</div>
                </div>
                <button class="btn ${i === 0 ? 'btn-ghost' : 'btn-dark'}" style="padding:8px 16px">${i === 0 ? 'Cancel' : 'Buy'}</button>
              </div>
              ${i === 0 ? `<div style="border-top:1px solid var(--rule);margin-top:14px;padding-top:14px">
                <div style="font-size:12.5px;color:var(--ink-soft)">Simultaneous calls</div>
                <div style="display:flex;align-items:center;gap:12px;margin-top:9px">
                  <button class="btn btn-ghost" style="padding:6px 14px">−</button>
                  <span style="font-size:17px;font-variant-numeric:tabular-nums">2</span>
                  <button class="btn btn-ghost" style="padding:6px 14px">+</button>
                </div>
                <button class="btn btn-sig" style="width:100%;margin-top:14px">Buy for ₦27,000</button>
                <p class="hint" style="margin-top:9px">Charged to your wallet now, then monthly.</p>
              </div>` : ''}
            </div>`).join('')}
        </div>
      </div>
      <div style="height:26px"></div>
    </div>`;

  /* ---------- Settings ---------- */
  VIEWS.settings = () => `${sbar()}
    ${bigHead('Settings')}
    <div class="body">
      <div class="pad"><div class="card" style="display:flex;align-items:center;gap:13px">
        <span class="avatar" style="width:44px;height:44px;font-size:15px">EG</span>
        <div style="flex:1"><div style="font-size:15px">Emmanuel Gbolade</div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px">Owner · Bloom Interiors</div></div>
        <span class="envdot"><span class="pulse"></span>Sandbox</span>
      </div>
      <p class="hint" style="margin-top:12px">In sandbox your calls use test carriers and cost nothing — and nothing you dial actually rings. Finish going live to use real numbers.</p></div>

      <div class="sec"><div class="sec-h"><span class="k">This device</span></div>
        <div class="slist">
          <button class="sitem"><span style="color:var(--signal)">${I.phone(19)}</span><span class="l">Take calls on this phone</span><span class="r">On</span></button>
          <button class="sitem"><span style="color:var(--signal)">${I.bolt(19)}</span><span class="l">Ring when the app is closed</span><span class="r">On</span></button>
          <button class="sitem"><span style="color:var(--signal)">${I.mic(19)}</span><span class="l">Microphone</span><span class="r">Allowed</span></button>
        </div>
        <div class="pad"><p class="hint" style="margin-top:10px">Turn the first one off and calls ring your other devices instead. Nothing is missed — the agent still answers.</p></div>
      </div>

      <div class="sec"><div class="sec-h"><span class="k">Workspace</span></div>
        <div class="slist">
          <button class="sitem" data-go="numbers"><span style="color:var(--signal)">${I.grid(19)}</span><span class="l">Numbers</span><span class="r">3 active ${I.chev(15)}</span></button>
          <button class="sitem" data-go="team"><span style="color:var(--signal)">${I.person(19)}</span><span class="l">Team</span><span class="r">4 people ${I.chev(15)}</span></button>
          <button class="sitem" data-go="golive"><span style="color:var(--signal)">${I.shield(19)}</span><span class="l">Go live</span><span class="r" style="color:var(--warn)">2 steps left ${I.chev(15)}</span></button>
        </div>
      </div>

      <div class="sec">
        <div class="slist">
          <button class="sitem" data-go="help"><span class="l">Help</span><span class="r">${I.chev(15)}</span></button>
          <button class="sitem danger" data-go="signin"><span class="l">Sign out</span></button>
        </div>
        <div class="pad"><p class="hint" style="margin-top:12px;text-align:center">Telroi 1.0 · Compliance and agent setup live on the web app, where the screen is bigger.</p></div>
      </div>
    </div>`;


  /* ============================================================
     Wallet — statement, one transaction, the reserved account
     ============================================================ */
  VIEWS.statement = () => `${sbar()}
    ${backHead('Statement', 'Every movement, newest first', `<button class="iconbtn">${I.copy(19)}</button>`)}
    <div class="seg"><button class="on">All</button><button>Money in</button><button>Money out</button></div>
    <div class="body">
      <div class="daylabel">August 2026</div>
      <div class="rows flush">
        ${LEDGER.map((l, i) => `<button class="row" style="min-height:64px" data-go="txn">
          <div class="mid"><div class="nm" style="font-size:14.5px">${l.t}</div>
            <div class="meta">${l.d}</div></div>
          <div class="rt"><span style="font-size:15px">${money(l.a, l.c, l.pos ? 'pos' : '')}</span>
            <span class="time" style="font-size:11.5px">${['₦48,163','₦49,404','₦49,500','₦49,596','₦52,096'][i]}</span></div>
          <span class="chev">${I.chev(16)}</span></button>`).join('')}
      </div>
      <div class="daylabel">July 2026</div>
      <div class="rows flush">
        <button class="row" style="min-height:64px" data-go="txn">
          <div class="mid"><div class="nm" style="font-size:14.5px">Top-up · Bank transfer</div>
            <div class="meta">28 Jul · Wema Bank</div></div>
          <div class="rt"><span style="font-size:15px">${money('+75,000', '00', 'pos')}</span></div>
          <span class="chev">${I.chev(16)}</span></button>
        <button class="row" style="min-height:64px" data-go="txn">
          <div class="mid"><div class="nm" style="font-size:14.5px">Calls · July</div>
            <div class="meta">31 Jul</div></div>
          <div class="rt"><span style="font-size:15px">${money('−31,884', '20')}</span></div>
          <span class="chev">${I.chev(16)}</span></button>
      </div>
      <div class="pad"><button class="btn btn-ghost btn-block" style="margin-top:18px">Load older</button></div>
    </div>`;

  VIEWS.txn = () => `${sbar()}
    ${backHead('Calls · 24 Aug', 'Usage charge')}
    <div class="body">
      <div style="padding:26px var(--gut) 4px;text-align:center">
        <div class="bignum" style="font-size:38px">${money('−₦1,240', '55')}</div>
        <div style="margin-top:10px"><span class="chip chip--ok">Settled</span></div>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">What made it up</span></div>
        <div class="pad"><div class="card" style="padding:4px 16px">
          <div class="kv"><span class="k">Outgoing · 38 min at ₦18.40</span><span class="v">${money('₦699', '20')}</span></div>
          <div class="kv"><span class="k">Incoming · 41 min at ₦9.60</span><span class="v">${money('₦393', '60')}</span></div>
          <div class="kv"><span class="k">Agent handling · 9 calls</span><span class="v">${money('₦147', '75')}</span></div>
        </div></div>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">Detail</span></div>
        <div class="pad"><div class="card" style="padding:4px 16px">
          <div class="kv"><span class="k">Balance after</span><span class="v">${money('₦48,163', '45')}</span></div>
          <div class="kv"><span class="k">Posted</span><span class="v">24 Aug 2026, 00:05</span></div>
          <div class="kv"><span class="k">Reference</span><span class="v mono" style="font-size:12.5px">usg_24aug_9f21c4</span></div>
        </div></div>
        <div class="pad"><p class="hint" style="margin-top:12px">Usage is totalled once a day, so a call you made this afternoon appears on tomorrow's line.</p></div>
      </div>
      <div class="pad"><button class="btn btn-ghost btn-block" style="margin-top:6px">See the 47 calls behind this</button></div>
    </div>`;

  /* ============================================================
     Settings — numbers, team, go live, help
     ============================================================ */
  VIEWS.numbers = () => `${sbar()}
    ${backHead('Numbers', '3 on this workspace', `<button class="iconbtn">${I.plus(21)}</button>`)}
    <div class="body">
      <div class="daylabel">In use</div>
      <div class="rows avatars">
        ${NUMBERS.map(n => `<button class="row" data-go="numberDetail">
          <span class="bub ${n.st === 'active' ? 'sig-b' : ''}">${n.st === 'active' ? I.phone(17) : I.shield(17)}</span>
          <div class="mid"><div class="nm" style="font-variant-numeric:tabular-nums">${n.n}</div>
            <div class="meta">${n.label}<span class="dot"></span>${n.st === 'indemnity'
              ? '<span style="color:var(--warn)">Needs indemnity</span>' : n.carrier}</div></div>
          <div class="rt"><span class="time">${n.monthly}/mo</span></div>
          <span class="chev">${I.chev(16)}</span></button>`).join('')}
      </div>
      <div class="pad"><p class="hint" style="margin-top:16px">Buying another number needs compliance approval. You have two steps left.</p>
        <button class="btn btn-ghost btn-block" style="margin-top:12px" data-go="golive">Finish going live</button></div>
    </div>`;

  VIEWS.numberDetail = () => `${sbar()}
    ${backHead('+234 1 888 0042', 'Main line · Lagos')}
    <div class="body">
      <div style="padding:22px var(--gut) 0;text-align:center">
        <div class="bignum">+234 1 888 0042</div>
        <div style="margin-top:11px;display:flex;gap:7px;justify-content:center">
          <span class="chip chip--ok">Active</span><span class="chip">Sotel</span><span class="chip">₦2,500/mo</span>
        </div>
      </div>
      <div class="acts">
        <button class="act" data-go="dialer">${I.phone(19)}Call from</button>
        <button class="act" data-copy="+234 1 888 0042">${I.copy(19)}Copy</button>
        <button class="act">${I.lines(19)}Routing</button>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">How calls are handled</span></div>
        <div class="slist">
          <button class="sitem"><span class="l">Rings</span><span class="r">Everyone, then the agent ${I.chev(15)}</span></button>
          <button class="sitem"><span class="l">Record calls</span><span class="r">On</span></button>
          <button class="sitem"><span class="l">Business hours</span><span class="r">8am–6pm WAT ${I.chev(15)}</span></button>
          <button class="sitem"><span class="l">Voicemail</span><span class="r">Off</span></button>
        </div>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">This month</span></div>
        <div class="twoup">
          <div class="stat"><div class="l">Minutes</div><div class="v">412</div></div>
          <div class="stat"><div class="l">Calls</div><div class="v">168</div></div>
        </div>
      </div>
      <div class="sec"><div class="slist">
        <button class="sitem danger"><span class="l">Release this number</span></button>
      </div>
        <div class="pad"><p class="hint" style="margin-top:12px">Releasing is permanent. The number goes back to the carrier and cannot be recovered.</p></div>
      </div>
    </div>`;

  VIEWS.team = () => `${sbar()}
    ${backHead('Team', '4 people · you are the owner', `<button class="iconbtn">${I.plus(21)}</button>`)}
    <div class="body">
      <div class="daylabel">Members</div>
      <div class="rows avatars">
        ${TEAM.map(m => `<button class="row" data-sheet="member">
          <span class="bub ${m.you ? 'sig-b' : ''}">${m.n.split(' ').map(x => x[0]).join('')}</span>
          <div class="mid"><div class="nm">${m.n}${m.you ? ' <span style="color:var(--ink-mute);font-weight:400">· you</span>' : ''}</div>
            <div class="meta">${m.role}<span class="dot"></span>${m.pending ? '<span style="color:var(--warn)">Invite not accepted</span>' : 'Extension ' + m.ext}</div></div>
          <span class="chev">${I.chev(16)}</span></button>`).join('')}
      </div>
      <div class="pad">
        <button class="btn btn-dark btn-block" style="margin-top:18px">${I.plus(18)} Invite someone</button>
        <p class="hint" style="margin-top:14px">Members take and make calls and use contacts. Admins can also see the wallet and buy numbers. Only you can change the plan.</p>
      </div>
    </div>`;

  VIEWS.golive = () => `${sbar()}
    ${backHead('Go live', 'Two steps left')}
    <div class="body">
      <div style="padding:20px var(--gut) 22px">
        <p class="hint">Live workspaces use real carriers and are billed. Until then you are on the demo number below, and nothing costs anything.</p>
      </div>
      <div class="steps">
        <div class="step done"><span class="dot">${I.shield(12)}</span>
          <div><div class="t">Business details</div><div class="d">Bloom Interiors, Lagos · added 12 August</div></div></div>
        <div class="step now"><span class="dot">2</span>
          <div><div class="t">Documents</div>
            <div class="d">CAC certificate and a director's ID are with our compliance team. They usually come back within two working days.</div>
            <div style="margin-top:9px"><span class="chip chip--warn"><span class="pulse"></span>In review since 22 August</span></div></div></div>
        <div class="step"><span class="dot">3</span>
          <div><div class="t">Signed undertaking</div>
            <div class="d">A short document about how the numbers will be used. It opens once the documents clear.</div></div></div>
      </div>
      <div class="pad">
        <button class="btn btn-ghost btn-block" disabled>Take Bloom Interiors live</button>
        <p class="hint" style="margin-top:12px;text-align:center">Documents and signatures happen on the web app, where the forms are readable.</p>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">While you wait</span></div>
        <div class="pad"><div class="card">
          <div style="font-size:12.5px;color:var(--ink-soft)">Your demo number</div>
          <div class="copyrow" style="margin-top:8px">
            <span class="bignum" style="font-size:22px">+234 1 888 0000</span>
            <button class="copybtn" data-copy="+234 1 888 0000">${I.copy(15)} Copy</button>
          </div>
          <p class="hint" style="margin-top:10px">Shared with other workspaces in sandbox, so use it for testing rather than giving it to anyone.</p>
        </div></div>
      </div>
    </div>`;

  VIEWS.help = () => `${sbar()}
    ${backHead('Help')}
    <div class="body">
      <div class="sec" style="margin-top:14px"><div class="slist">
        <button class="sitem"><span class="l">Why is a call not connecting?</span><span class="r">${I.chev(15)}</span></button>
        <button class="sitem"><span class="l">What the agent does when nobody answers</span><span class="r">${I.chev(15)}</span></button>
        <button class="sitem"><span class="l">How calls are charged</span><span class="r">${I.chev(15)}</span></button>
        <button class="sitem"><span class="l">Getting a number</span><span class="r">${I.chev(15)}</span></button>
      </div></div>
      <div class="sec"><div class="sec-h"><span class="k">Still stuck</span></div>
        <div class="pad"><div class="card">
          <div style="font-size:14.5px">Talk to us</div>
          <p class="hint" style="margin-top:6px">Weekdays, 8am to 6pm WAT. We usually answer within the hour.</p>
          <button class="btn btn-signal btn-block" style="margin-top:14px">Start a conversation</button>
        </div></div>
      </div>
      <div class="pad"><p class="hint" style="margin-top:18px;text-align:center">Telroi 1.0 (build 214) · Workspace bloom</p></div>
    </div>`;

  /* ============================================================
     Contacts — one person
     ============================================================ */
  VIEWS.contactDetail = () => `${sbar()}
    ${backHead('Adaeze Okafor', 'Customer since March', `<button class="iconbtn">${I.note(20)}</button>`)}
    <div class="body">
      <div style="padding:22px var(--gut) 0;text-align:center">
        <span class="bub sig-b" style="width:64px;height:64px;font-size:21px;margin:0 auto">AO</span>
        <div style="font-family:var(--font-display);font-size:23px;letter-spacing:-.02em;margin-top:13px">Adaeze Okafor</div>
        <div style="font-size:13.5px;color:var(--ink-soft);margin-top:5px;font-variant-numeric:tabular-nums">+234 803 220 4417</div>
      </div>
      <div class="acts">
        <button class="act" data-go="incall">${I.phone(19)}Call</button>
        <button class="act" data-sheet="status">${I.star(19)}Status</button>
        <button class="act" data-copy="+234 803 220 4417">${I.copy(19)}Copy</button>
        <button class="act">${I.note(19)}Note</button>
      </div>
      <div class="sec"><div class="twoup">
        <div class="stat"><div class="l">Calls</div><div class="v">9</div></div>
        <div class="stat"><div class="l">Talked for</div><div class="v" style="font-size:19px">41m</div></div>
      </div></div>
      <div class="sec"><div class="sec-h"><span class="k">Notes</span><span class="a">Add</span></div>
        <div class="pad"><div class="card">
          <p style="font-size:14px;line-height:1.55">Ordered the grey three-seater on the 14th. Wants the driver to ring before delivery.</p>
          <div style="font-size:12px;color:var(--ink-mute);margin-top:9px">You · today, 4:41 PM</div>
        </div></div>
      </div>
      <div class="sec"><div class="sec-h"><span class="k">Every call with her</span></div>
        <div class="rows">
          ${CALLS.filter(c => c.name === 'Adaeze Okafor').concat([
            { dir:'out', at:'19 Aug', dur:'4m 02s', rec:true, id:'c8' },
            { dir:'in',  at:'14 Aug', dur:'8m 55s', rec:true, id:'c9' },
            { dir:'in',  at:'2 Aug',  dur:'1m 12s', id:'c0' },
          ]).map(c => `<button class="row" data-go="detail">
            <span class="glyph ${c.dir === 'in' ? 'in' : ''}">${c.dir === 'in' ? I.arrowIn(19) : I.arrowOut(19)}</span>
            <div class="mid"><div class="nm" style="font-size:14.5px">${c.dir === 'in' ? 'Incoming' : 'Outgoing'}</div>
              <div class="meta">${c.dur}</div></div>
            <div class="rt"><span class="time">${c.at}</span>${c.rec ? sigRow(c.id.charCodeAt(1) * 37) : ''}</div>
            <span class="chev">${I.chev(16)}</span></button>`).join('')}
        </div>
      </div>
      <div class="sec"><div class="slist">
        <button class="sitem"><span class="l">Archive</span><span class="r">${I.chev(15)}</span></button>
        <button class="sitem danger"><span class="l">Delete contact</span></button>
      </div></div>
    </div>`;

  /* ============================================================
     Sheets
     ============================================================ */
  const SHEETS = {
    topup: () => `<div class="grab"></div>
      <h3>Top up</h3>
      <div class="modeseg" style="margin-top:14px">
        <button class="${PAYMODE === 'transfer' ? 'on' : ''}" data-mode="transfer">Bank transfer</button>
        <button class="${PAYMODE === 'card' ? 'on' : ''}" data-mode="card">Card</button>
      </div>
      ${PAYMODE === 'transfer' ? `
        <p class="hint">Send any amount to your own account below. It is yours permanently — save it as a beneficiary and top up whenever.</p>
        ${VACCT.accounts.map((ac, i) => `<div class="card" style="margin-top:${i ? 10 : 14}px">
          <div style="font-size:12.5px;color:var(--ink-soft)">${ac.bankName}</div>
          <div class="copyrow" style="margin-top:7px">
            <span class="bignum">${ac.accountNumber}</span>
            <button class="copybtn" data-copy="${ac.accountNumber}">${I.copy(15)} Copy</button>
          </div>
        </div>`).join('')}
        <div class="kv" style="border-top:1px solid var(--rule-2);margin-top:14px">
          <span class="k">Account name</span><span class="v" style="font-size:13px">${VACCT.accountName}</span></div>
        <p class="hint" style="margin-top:14px">Transfers usually land in under a minute and your balance moves on its own — you do not have to come back and tell us.</p>
      ` : `
        <p class="hint">Minimum ₦5,000. Paystack opens in its own window, so your card details never touch this app.</p>
        <div class="amtgrid">
          <button>₦5,000</button><button>₦10,000</button><button class="on">₦25,000</button>
          <button>₦50,000</button><button>₦100,000</button><button>Other</button>
        </div>
        <button class="btn btn-dark btn-block" data-close="1">Continue to Paystack</button>
      `}`,
    member: () => `<div class="grab"></div>
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:18px">
        <span class="bub sig-b" style="width:46px;height:46px;font-size:15px">AB</span>
        <div><div style="font-size:16px">Adunni Bello</div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px">adunni@bloominteriors.ng</div></div>
      </div>
      <div class="sec-h" style="padding-left:0"><span class="k">Role</span></div>
      <div class="slist" style="border-radius:12px;overflow:hidden;border:1px solid var(--rule)">
        <button class="sitem"><span class="l">Owner</span><span class="r">Only one person</span></button>
        <button class="sitem"><span class="l">Admin</span><span class="r" style="color:var(--signal)">${I.shield(16)} Current</span></button>
        <button class="sitem"><span class="l">Member</span><span class="r">${I.chev(15)}</span></button>
      </div>
      <p class="hint" style="margin-top:12px">Changing a role takes effect immediately, including on any device they are signed in on.</p>
      <button class="btn btn-ghost btn-block" style="margin-top:16px;color:var(--danger);border-color:var(--rule)" data-close="1">Remove from workspace</button>`,

    status: () => `<div class="grab"></div>
      <h3>Status</h3>
      <p class="hint">How this person is filed. It is yours to define — nothing in Telroi behaves differently.</p>
      <div class="amtgrid" style="grid-template-columns:1fr 1fr">
        <button class="on">Customer</button><button>Lead</button>
        <button>Supplier</button><button>Not interested</button>
      </div>
      <button class="btn btn-dark btn-block" data-close="1">Save</button>`,

    numbers: () => `<div class="grab"></div>
      <h3>Call from</h3>
      <p class="hint">Whoever you call sees this number, and it decides which carrier carries the call.</p>
      <div style="margin:16px 0">
        <button class="sitem" style="border:1px solid var(--signal);border-radius:12px;background:var(--signal-soft);margin-bottom:9px" data-close="1">
          <span class="l" style="font-variant-numeric:tabular-nums">+234 1 888 0042</span>
          <span class="r" style="color:var(--signal)">Lagos · Sotel</span></button>
        <button class="sitem" style="border:1px solid var(--rule);border-radius:12px;margin-bottom:9px" data-close="1">
          <span class="l" style="font-variant-numeric:tabular-nums">+234 703 900 1188</span>
          <span class="r">Mobile · Ruach</span></button>
        <button class="sitem" style="border:1px solid var(--rule);border-radius:12px;opacity:.6" data-go="numberDetail">
          <span class="l" style="font-variant-numeric:tabular-nums">+1 415 200 7788</span>
          <span class="r" style="color:var(--warn)">Needs indemnity ${I.chev(14)}</span></button>
      </div>`,
  };

  /* ============================================================
     Render + wiring
     ============================================================ */
  let PAYMODE = 'transfer';
  // Which tab a pushed screen lives under, so the bar stays honest when a screen
  // is opened directly rather than walked to.
  const OWNER = {
    detail:'calls', contacts:'home', contactDetail:'home', statement:'wallet', txn:'wallet',
    buynumber:'settings',
    numbers:'settings', numberDetail:'settings', team:'settings', golive:'settings', help:'settings',
  };
  const DARK = new Set(['incall', 'incoming']);
  const NOTES = {
    signin:  '<b>Sign in</b> — email, then a code. No password exists on Telroi, so the app never builds a password screen it would have to secure.',
    otp:     '<b>The code</b> — six boxes, one tap of the keyboard each, and the paste-from-SMS suggestion lands on the first. Three wrong tries kills it.',
    calls:   '<b>Call history</b> — the waveform on a row is not decoration: it means the call has audio you can play. Bold means you have not opened it.',
    detail:  '<b>A call</b> — the transcript is the object, not the audio. Tapping any line moves the player to it. Cost is shown because it is charged.',
    contacts:'<b>Contacts</b> — the CRM. Records make themselves out of calls, so the screen is rarely empty and the add button is not the point.',
    dialer:  '<b>Dialer</b> — the number you call from sits at the top, because it decides both the caller ID and the carrier. Never make it a hidden setting.',
    incoming:'<b>Incoming</b> — what a VoIP push produces. The countdown is honest about the agent: answer and it stands down.',
    incall:  '<b>In call</b> — the one screen nobody reads. Inverted, six controls, nothing to think about.',
    wallet:  '<b>Wallet</b> — the balance is the screen. Kobo sit in superscript so the naira read as one number at a glance.',
    settings:'<b>Settings</b> — device first, because "does my phone ring" is the question people open this screen with.',
    statement:'<b>Statement</b> — the full ledger, grouped by month, with the running balance on the right. Every row opens.',
    txn:'<b>One charge</b> — a figure a client queries needs an answer. Usage rows break down into minutes, rate and agent handling.',
    numbers:'<b>Numbers</b> — what the workspace holds, what each costs, and which one still needs an indemnity agreement.',
    numberDetail:'<b>One number</b> — routing, recording and hours live here, because they are properties of the line, not the app.',
    team:'<b>Team</b> — roles are the whole screen. What each role can do is stated in plain words, not left to be discovered by a 403.',
    golive:'<b>Go live</b> — three ordered steps with real status. The demo number sits at the bottom so a blocked workspace still has something to do.',
    help:'<b>Help</b> — four questions people actually ask, then a way to reach a person.',
    contactDetail:'<b>One contact</b> — notes and every call with them. The call rows say direction rather than repeating the name.',
  };

  const app = root.querySelector('#mt-app');
    const caption = root.querySelector('#mt-caption');
  const TABBED = ['home', 'calls', 'dialer', 'wallet', 'settings'];
  const NOCHROME = new Set(['signin', 'otp', 'incall', 'incoming']);
  let STACK = ['home'];
  const topScreen = () => STACK[STACK.length - 1];

  function render(name) {
    if (name) {
      if (TABBED.includes(name)) STACK = [name];
      else if (NOCHROME.has(name)) STACK = [name];
      else if (name !== topScreen()) STACK.push(name);
    }
    name = topScreen();
    app.innerHTML = `<div class="scr on ${DARK.has(name) ? 'dark-scr' : ''}">${VIEWS[name]()}${
      NOCHROME.has(name) ? '' : tabs(OWNER[name] || (TABBED.includes(STACK[0]) ? STACK[0] : 'calls'))}</div>`;
    caption.innerHTML = NOTES[name] || '';
    root.querySelectorAll('.rail .nav').forEach(b => b.classList.toggle('on', b.dataset.go === name));
    if (name === 'detail') paintWave();
    if (name === 'incall') runTimer();
  }
  function paintWave() {
    const w = root.querySelector('#wave');
    if (!w) return;
    [...w.children].forEach((b, i) => { if (i < 8) b.classList.add('played'); });
  }
  let timerT;
  function runTimer() {
    clearInterval(timerT);
    let s = 42;
    timerT = setInterval(() => {
      const el = root.querySelector('#timer');
      if (!el) return clearInterval(timerT);
      s++;
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }
  function openSheet(k) {
    const w = document.createElement('div');
    w.className = 'sheetwrap on';
    w.innerHTML = `<div class="scrim" data-close="1"></div><div class="sheet">${SHEETS[k]()}</div>`;
    app.appendChild(w);
  }

  function toast(msg) {
    app.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    app.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  const onClick = e => {
    const copy = e.target.closest('[data-copy]');
    const mode = e.target.closest('[data-mode]');
    const go = e.target.closest('[data-go]');
    const sheet = e.target.closest('[data-sheet]');
    const close = e.target.closest('[data-close]');
    const back = e.target.closest('[data-back]');
    const key = e.target.closest('[data-key]');
    const tog = e.target.closest('[data-tog]');
    const seg = e.target.closest('.seg button');

    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
      toast('Copied');
      return;
    }
    if (mode) {
      PAYMODE = mode.dataset.mode;
      const sheet = document.querySelector('.sheetwrap .sheet');
      if (sheet) sheet.innerHTML = SHEETS.topup();
      return;
    }
    if (close) { document.querySelector('.sheetwrap')?.remove(); return; }
    if (sheet) { openSheet(sheet.dataset.sheet); return; }
    if (back) { if (STACK.length > 1) STACK.pop(); render(); return; }
    if (key) {
      if (key.dataset.key === 'del') DIGITS = DIGITS.trim().slice(0, -1);
      else if (DIGITS.replace(/\s/g, '').length < 11) {
        DIGITS = (DIGITS + key.dataset.key).replace(/\s/g, '').replace(/(\d{3})(\d{3})?(\d{0,4})?/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
      }
      render('dialer'); return;
    }
    if (tog) {
      if (tog.dataset.tog === 'mute') MUTED = !MUTED; else SPK = !SPK;
      render('incall'); return;
    }
    if (seg) { seg.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on')); seg.classList.add('on'); return; }
    if (go) { render(go.dataset.go); return; }
    };





  return { render, onClick, views: Object.keys(VIEWS) };
}
