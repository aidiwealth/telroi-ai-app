// GET /widget/v1.js -> the embeddable Live Call widget script. Served with
// permissive CORS + caching. Usage on a website:
//   <script src="https://app.telroi.ai/widget/v1.js"
//           data-telroi-key="WIDGET_KEY"
//           data-user-id="optional-logged-in-user-id"
//           data-user-name="optional" data-user-phone="optional"></script>
// visitorType is 'user' when data-user-id is present, else 'visitor' (landing).
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/javascript; charset=utf-8');
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  setHeader(event, 'Cache-Control', 'public, max-age=300');
  const base = (useRuntimeConfig().public as any).appBaseUrl || '';
  return WIDGET_JS.replace(/__BASE__/g, base);
});

const WIDGET_JS = String.raw`(function () {
  // Find our own script tag. document.currentScript works for inline <script>
  // tags but is null when the script is injected dynamically (appendChild),
  // so fall back to locating it by id or src.
  var S = document.currentScript
    || document.getElementById('telroi-livecall')
    || (function () { var all = document.querySelectorAll('script[data-telroi-key],script[src*="/widget/v1.js"]'); return all.length ? all[all.length - 1] : null; })();
  var KEY = S && S.getAttribute('data-telroi-key');
  if (!KEY) { console.warn('[Telroi] data-telroi-key missing'); return; }
  var BASE = '__BASE__';
  var userId = S.getAttribute('data-user-id') || '';
  var userName = S.getAttribute('data-user-name') || '';
  var userPhone = S.getAttribute('data-user-phone') || '';
  // Landing-page visitor vs logged-in user of the client's product.
  var visitorType = userId ? 'user' : 'visitor';
  var cfg = null, sessionId = null;
  var widgetCall = null, callStartedAt = 0, callDuration = 0;

  function api(path, body) {
    return fetch(BASE + '/widget/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }

  function mount() {
    var pos = (cfg.bubblePosition || 'middle-right');
    var isLeft = pos.indexOf('left') > -1;
    var isMiddle = pos.indexOf('middle') > -1;
    var color = cfg.bubbleColor || '#1a4b72';
    if (!document.getElementById('tlr-kf')) { var kf = document.createElement('style'); kf.id='tlr-kf'; kf.textContent='@keyframes tlrPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}'; document.head.appendChild(kf); }

    // One-time keyframes for the modal pop-in.
    if (!document.getElementById('tlr-kf')) {
      var kf = document.createElement('style'); kf.id = 'tlr-kf';
      kf.textContent = '@keyframes tlrPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}';
      document.head.appendChild(kf);
    }

    // Collapsed launcher. On middle positions it's an edge tab matching the
    // to-do widget's size (46px wide, hugging the edge). Otherwise a round FAB.
    var root = el('div', 'position:fixed;z-index:2147483000;font-family:-apple-system,Segoe UI,Roboto,sans-serif');
    var bubble;
    if (isMiddle) {
      // Centered on the edge, lifted above the to-do widget so they don't overlap.
      root.style.cssText += (isLeft ? 'left:0;' : 'right:0;') + 'top:50%;transform:translateY(-50%) translateY(-66px);';
      bubble = el('button', 'width:46px;box-sizing:border-box;border:none;cursor:pointer;background:' + color + ';color:#fff;display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 10px;border-radius:' + (isLeft ? '0 12px 12px 0' : '12px 0 0 12px') + ';box-shadow:-4px 4px 16px rgba(10,10,11,0.16);transition:transform .15s',
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg>');
    } else {
      root.style.cssText += (isLeft ? 'left:20px;' : 'right:20px;') + 'bottom:20px;';
      bubble = el('button', 'width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);background:' + color + ';color:#fff;display:flex;align-items:center;justify-content:center;transition:transform .15s',
        '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg>');
    }
    bubble.onmouseenter = function () { bubble.style.transform = (isMiddle ? 'translateY(-50%) ' : '') + 'scale(1.06)'; bubble.style.transform = 'scale(1.06)'; };
    bubble.onmouseleave = function () { bubble.style.transform = 'scale(1)'; };

    // Centered modal overlay over the whole page (matches the to-do modal).
    var overlay = el('div', 'display:none;position:fixed;inset:0;z-index:2147483001;background:rgba(10,10,11,.40);align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif');
    var panel = el('div', 'width:100%;max-width:360px;max-height:84vh;display:flex;flex-direction:column;background:#fff;border-radius:20px;box-shadow:0 32px 80px rgba(10,10,11,.32),0 2px 8px rgba(10,10,11,.08);overflow:hidden;animation:tlrPop .22s cubic-bezier(.16,1,.3,1)');
    overlay.appendChild(panel);
    overlay.onclick = function (e) { if (e.target === overlay) closePanel(); };

    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:20px 22px 6px;background:#fff');
    var headSub = el('div', 'display:flex;align-items:center;gap:7px;font-size:12.5px;color:#5f5c55');
    headSub.innerHTML = '<span style=\"width:7px;height:7px;border-radius:50%;background:#00d28a;box-shadow:0 0 0 3px rgba(0,210,138,.18)\"></span>We\'re online now';
    var headClose = el('button', 'flex:none;background:#f2f0ec;border:none;color:#9a9690;cursor:pointer;width:28px;height:28px;border-radius:50%;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s', '&times;');
    headClose.onmouseenter = function(){ headClose.style.color = '#0A0A0B'; headClose.style.background = '#e8e5df'; };
    headClose.onmouseleave = function(){ headClose.style.color = '#9a9690'; headClose.style.background = '#f2f0ec'; };
    headClose.onclick = function () { closePanel(); };
    head.appendChild(headSub); head.appendChild(headClose);
    var bodyWrap = el('div', 'padding:6px 22px 24px;overflow-y:auto');
    panel.appendChild(head); panel.appendChild(bodyWrap);

    function showForm() {
      bodyWrap.innerHTML = '';
      var hero = el('div', 'text-align:center;padding:6px 0 2px');
      var orb = el('div', 'position:relative;width:104px;height:104px;margin:0 auto 16px');
      orb.innerHTML = '<div style="position:absolute;inset:0;border-radius:50%;background:' + hexA(color,.10) + '"></div>'
        + '<div style="position:absolute;inset:12px;border-radius:50%;background:' + hexA(color,.16) + '"></div>'
        + '<div style="position:absolute;inset:24px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center">'
        + '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .35 1.94.65 2.84a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.3 1.84.52 2.84.65A2 2 0 0 1 22 16.92z"/></svg></div>';
      var title = el('div', 'font-size:18px;font-weight:600;color:#1a1a1a;letter-spacing:-.01em', cfg.greeting || 'Call our team');
      var sub = el('div', 'font-size:13px;color:#8a877f;margin:5px 0 18px;line-height:1.5', "Enter your details \u2014 we'll ring you back in seconds.");
      hero.appendChild(orb); hero.appendChild(title); hero.appendChild(sub);
      var row = el('div', 'display:flex;gap:9px;margin-bottom:12px');
      var n = el('input'); n.placeholder = 'Name'; n.value = userName; n.style.cssText = pill(); focusable(n, color);
      var ph = el('input'); ph.placeholder = 'Number'; ph.value = userPhone; ph.type = 'tel'; ph.style.cssText = pill(); focusable(ph, color);
      row.appendChild(n); row.appendChild(ph);
      var btn = el('button', orbBtnCss(color), 'Request call<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px;vertical-align:-3px"><path d="M5 12h14M13 6l6 6-6 6"/></svg>');
      btnHover(btn);
      var err = el('div', 'color:#c0392b;font-size:12px;margin-top:10px;text-align:center;display:none');
      btn.onclick = function () {
        if (!n.value.trim() || ph.value.replace(/\D/g,'').length < 6) { err.style.display = 'block'; err.textContent = 'Please enter your name and a valid mobile number.'; return; }
        btn.disabled = true; btn.innerHTML = 'Connecting\u2026';
        api('session', { key: KEY, name: n.value.trim(), phone: ph.value.trim(), visitorType: visitorType, externalUserId: userId, pageUrl: location.href })
          .then(function (r) { if (!r.ok) throw 0; sessionId = r.sessionId; return api('call', { key: KEY, sessionId: sessionId }); })
          .then(function (r) { showCalling(r); })
          .catch(function () { if (cfg.csatEnabled && sessionId) { showCsat('failed'); } else { btn.disabled = false; btn.innerHTML = 'Request call'; err.style.display = 'block'; err.textContent = 'Could not connect. Please try again.'; } });
      };
      bodyWrap.appendChild(hero); bodyWrap.appendChild(row); bodyWrap.appendChild(btn); bodyWrap.appendChild(err);
    }
    function showCalling(callResp) {
      var routedTo = callResp.routedTo;
      var voice = callResp.voice;
      callStartedAt = 0;
      bodyWrap.innerHTML = '';
      var status = el('div', 'text-align:center;padding:14px 0');
      status.innerHTML = '<div style="font-size:14px;color:#333;margin-bottom:6px">Connecting you to ' + (routedTo === 'ai' ? 'our assistant' : 'an agent') + '…</div><div style="font-size:12px;color:#888">' + (voice ? 'Please allow microphone access.' : 'Setting up your call…') + '</div>';
      bodyWrap.appendChild(status);
      var end = el('button', btnCss('#c0392b'), 'End call');
      end.onclick = function () { hangupCall(); finishCall('answered'); };
      bodyWrap.appendChild(end);

      // Native bridge hook (iOS/Android WebView handle their own audio).
      if (window.TelroiLiveCall && window.TelroiLiveCall.onCall) window.TelroiLiveCall.onCall({ sessionId: sessionId, routedTo: routedTo, voice: voice });

      if (!voice) {
        // Provider not configured yet — tell the visitor honestly.
        status.innerHTML = '<div style="font-size:13px;color:#c0392b;padding:8px 0">Calling isn\'t available right now. Please try again later.</div>';
        return;
      }
      // Real in-browser audio via the resolved provider.
      startWebrtc(voice, routedTo, status);
    }

    // ── Real WebRTC for the widget (Twilio / Telnyx / Digidite) ──
    function loadJs(src, cb) { if (document.querySelector('script[src="' + src + '"]')) return cb(); var s = document.createElement('script'); s.src = src; s.async = true; s.onload = cb; s.onerror = function(){ cb(new Error('load failed')); }; document.head.appendChild(s); }
    function startWebrtc(voice, routedTo, status) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function () {
        var to = voice.callerId || '';   // destination is resolved server-side via TwiML/connection routing
        if (voice.provider === 'twilio') {
          loadJs('https://sdk.twilio.com/js/voice/releases/2.11.0/twilio.min.js', function () {
            var device = new window.Twilio.Device(voice.token, { codecPreferences: ['opus', 'pcmu'] });
            widgetCall = { provider: 'twilio', device: device };
            device.register();
            device.connect({ params: { To: to } }).then(function (conn) {
              widgetCall.conn = conn;
              conn.on('ringing', function () { status.innerHTML = '<div style="font-size:14px;color:#333">Ringing…</div>'; });
              conn.on('accept', function () { callStartedAt = Date.now(); status.innerHTML = '<div style="font-size:14px;color:#1a7a4f">Connected</div>'; });
              conn.on('disconnect', function () { finishCall('answered'); });
              conn.on('error', function () { status.innerHTML = '<div style="font-size:13px;color:#c0392b">Call error</div>'; });
            });
          });
        } else if (voice.provider === 'telnyx') {
          loadJs('https://unpkg.com/@telnyx/webrtc@2.22.0/lib/bundle.js', function () {
            var RTC = (window.TelnyxWebRTC && window.TelnyxWebRTC.TelnyxRTC) || (window.TelnyxRTC && window.TelnyxRTC.TelnyxRTC) || window.TelnyxWebRTC || window.TelnyxRTC;
            if (typeof RTC !== 'function') { console.error('[telroi widget] Telnyx WebRTC SDK failed to load'); return; }
            var client = new RTC({ login: voice.login, password: voice.password });
            widgetCall = { provider: 'telnyx', client: client };
            client.on('telnyx.ready', function () { widgetCall.conn = client.newCall({ destinationNumber: to, callerNumber: voice.callerId, audio: true, video: false }); status.innerHTML = '<div style="font-size:14px;color:#333">Ringing…</div>'; });
            client.on('telnyx.notification', function (n) { var st = n && n.call && n.call.state; if (st === 'active') { callStartedAt = Date.now(); status.innerHTML = '<div style="font-size:14px;color:#1a7a4f">Connected</div>'; } if (st === 'hangup' || st === 'destroy') finishCall('answered'); });
            client.connect();
          });
        } else if (voice.provider === 'digidite') {
          loadJs('https://cdnjs.cloudflare.com/ajax/libs/sip.js/0.21.2/sip.min.js', function () {
            var SIP = window.SIP;
            var ua = new SIP.UserAgent({ uri: SIP.UserAgent.makeURI('sip:' + voice.sipUsername + '@' + voice.sipDomain), transportOptions: { server: voice.wsServer }, authorizationUsername: voice.sipUsername, authorizationPassword: voice.sipPassword });
            widgetCall = { provider: 'digidite', ua: ua };
            ua.start().then(function () {
              var target = SIP.UserAgent.makeURI('sip:' + (to || voice.sipUsername) + '@' + voice.sipDomain);
              var inviter = new SIP.Inviter(ua, target, { sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
              widgetCall.conn = inviter;
              inviter.stateChange.addListener(function (st) {
                if (st === 'Establishing') status.innerHTML = '<div style="font-size:14px;color:#333">Ringing…</div>';
                if (st === 'Established') { callStartedAt = Date.now(); status.innerHTML = '<div style="font-size:14px;color:#1a7a4f">Connected</div>'; attachAudio(inviter); }
                if (st === 'Terminated') finishCall('answered');
              });
              inviter.invite();
            });
          });
        }
      }).catch(function () {
        status.innerHTML = '<div style="font-size:13px;color:#c0392b">Microphone access is needed to call. Please allow it and try again.</div>';
      });
    }
    function attachAudio(session) {
      try { var pc = session.sessionDescriptionHandler.peerConnection; var rs = new MediaStream(); pc.getReceivers().forEach(function (r) { if (r.track) rs.addTrack(r.track); }); var a = document.getElementById('telroi-wa') || (function(){ var x = document.createElement('audio'); x.id = 'telroi-wa'; x.autoplay = true; document.body.appendChild(x); return x; })(); a.srcObject = rs; } catch (e) {}
    }
    function hangupCall() {
      try {
        if (!widgetCall) return;
        if (widgetCall.provider === 'twilio') { widgetCall.conn && widgetCall.conn.disconnect(); widgetCall.device && widgetCall.device.destroy(); }
        if (widgetCall.provider === 'telnyx') { widgetCall.conn && widgetCall.conn.hangup(); widgetCall.client && widgetCall.client.disconnect(); }
        if (widgetCall.provider === 'digidite') { try { widgetCall.conn && widgetCall.conn.bye(); } catch (e) {} try { widgetCall.conn && widgetCall.conn.cancel(); } catch (e) {} widgetCall.ua && widgetCall.ua.stop(); }
      } catch (e) {}
      widgetCall = null;
    }
    function finishCall(outcome) {
      var secs = callStartedAt ? Math.round((Date.now() - callStartedAt) / 1000) : 0;
      callDuration = secs;
      hangupCall();
      if (cfg.csatEnabled) showCsat(outcome); else { api('csat', { key: KEY, sessionId: sessionId, outcome: outcome, seconds: secs }); closePanel(); reset(); }
    }
    function showCsat(outcome) {
      bodyWrap.innerHTML = '';
      bodyWrap.appendChild(el('p', 'font-size:13px;color:#333;margin:0 0 4px;font-weight:600', outcome === 'failed' ? 'Sorry, we couldn\'t connect you' : 'How was your call?'));
      bodyWrap.appendChild(el('p', 'font-size:12px;color:#888;margin:0 0 10px', outcome === 'failed' ? 'Your feedback still helps us improve.' : 'Rate your experience.'));
      var row = el('div', 'display:flex;gap:6px;justify-content:center;margin-bottom:10px');
      var chosen = 0;
      var stars = [];
      for (var i = 1; i <= 5; i++) (function (n) {
        var st = el('button', 'background:none;border:none;cursor:pointer;font-size:28px;color:#ddd;transition:color .1s', '\u2605');
        st.onmouseenter = function () { paint(n); };
        st.onclick = function () { chosen = n; paint(n); };
        stars.push(st); row.appendChild(st);
      })(i);
      function paint(n) { for (var k = 0; k < 5; k++) stars[k].style.color = k < n ? '#f5b301' : '#ddd'; }
      var cmt = el('textarea'); cmt.placeholder = 'Add a comment (optional)'; cmt.style.cssText = inp() + 'resize:none;height:54px';
      var submit = el('button', btnCss(cfg.bubbleColor || '#1a4b72'), 'Submit feedback');
      submit.onclick = function () {
        submit.disabled = true;
        api('csat', { key: KEY, sessionId: sessionId, score: chosen || undefined, comment: cmt.value || undefined, outcome: outcome, seconds: callDuration })
          .then(function(){ thanks(); }).catch(function(){ thanks(); });
      };
      bodyWrap.appendChild(row); bodyWrap.appendChild(cmt); bodyWrap.appendChild(submit);
    }
    function thanks() { bodyWrap.innerHTML = '<div style="text-align:center;padding:18px 0;font-size:14px;color:#333">Thanks for your feedback!</div>'; setTimeout(function(){ closePanel(); reset(); }, 1500); }
    function reset() { sessionId = null; showForm(); }

    function openPanel() { overlay.style.display = 'flex'; }
    function closePanel() { overlay.style.display = 'none'; }
    bubble.onclick = function () { openPanel(); };
    showForm();
    root.appendChild(bubble);
    document.body.appendChild(root);
    document.body.appendChild(overlay);
  }
  function inp() { return 'width:100%;box-sizing:border-box;padding:12px 14px;margin-bottom:10px;border:1px solid #e4e1da;border-radius:11px;font-size:14px;color:#0A0A0B;background:#faf9f6;outline:none;transition:border-color .15s,background .15s,box-shadow .15s;font-family:inherit'; }
  function pill() { return 'flex:1;min-width:0;box-sizing:border-box;padding:12px 13px;border:1px solid #eceae4;border-radius:12px;font-size:13.5px;color:#0A0A0B;background:#f5f4f0;outline:none;transition:border-color .15s,background .15s,box-shadow .15s;font-family:inherit'; }
  function orbBtnCss(c) { return 'width:100%;padding:15px;border:none;border-radius:999px;background:' + c + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-.01em;box-shadow:0 8px 22px ' + hexA(c, .32) + ';transition:transform .12s,box-shadow .15s,opacity .15s;display:flex;align-items:center;justify-content:center;font-family:inherit'; }
  function btnCss(c) { return 'width:100%;padding:13px;border:none;border-radius:11px;background:' + c + ';color:#fff;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:-.01em;box-shadow:0 6px 16px ' + hexA(c, .30) + ';transition:transform .12s,box-shadow .15s,opacity .15s;display:flex;align-items:center;justify-content:center;font-family:inherit'; }
  // Turn a hex color into rgba() with the given alpha (for soft shadows/rings).
  function hexA(hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16); if (isNaN(n)) return 'rgba(10,10,11,' + a + ')';
    return 'rgba(' + ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255) + ',' + a + ')';
  }
  // Add focus ring + hover affordances to an input, themed to the brand color.
  function focusable(input, c) {
    input.onfocus = function(){ input.style.borderColor = c; input.style.background = '#fff'; input.style.boxShadow = '0 0 0 3px ' + hexA(c, .14); };
    input.onblur = function(){ input.style.borderColor = '#e4e1da'; input.style.background = '#faf9f6'; input.style.boxShadow = 'none'; };
  }
  // Lift-on-hover for the primary button.
  function btnHover(btn) {
    btn.onmouseenter = function(){ if (!btn.disabled) btn.style.transform = 'translateY(-1px)'; };
    btn.onmouseleave = function(){ btn.style.transform = 'translateY(0)'; };
  }

  api('config?key=' + encodeURIComponent(KEY)).then(function (r) {
    if (!r || !r.ok) { console.warn('[Telroi] widget unavailable'); return; }
    cfg = r.config; mount();
  });
  // Mobile bridge: native apps (iOS/Android WebView) can preset identity + hook calls.
  window.TelroiLiveCall = window.TelroiLiveCall || {};
})();`;
