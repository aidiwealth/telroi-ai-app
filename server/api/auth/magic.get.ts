// GET /api/auth/magic?token=... -> render a confirm page. DOES NOT consume.
//
// Email security scanners (Outlook SafeLinks, Mimecast, Proofpoint, Google, …)
// prefetch every link in a message with a GET within seconds of delivery. A GET
// that consumed the single-use token would burn it — and the paired OTP in the
// same auth_tokens row — before the recipient ever clicked. So GET only shows a
// page with a button that POSTs the token. Scanners don't POST; the human does.
export default defineEventHandler((event) => {
  const token = getQuery(event).token as string | undefined;
  if (!token) return sendRedirect(event, '/login?error=missing_token');

  setHeader(event, 'content-type', 'text/html; charset=utf-8');
  setHeader(event, 'cache-control', 'no-store');
  setHeader(event, 'referrer-policy', 'no-referrer'); // never leak the token via Referer
  const t = String(token).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Confirm sign-in · Telroi</title>
<style>
  :root { --blue:#1a4b72; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f4f6f8; color:#0f172a; padding:24px;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { width:100%; max-width:400px; background:#fff; border:1px solid #e5e9ee; border-radius:16px;
    padding:32px; text-align:center; box-shadow:0 1px 3px rgba(16,24,40,.06); }
  .mark { display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px;
    border-radius:14px; background:var(--blue); color:#fff; font-weight:700; font-size:24px; margin-bottom:20px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0 0 24px; color:#475569; }
  button { width:100%; border:0; border-radius:10px; background:var(--blue); color:#fff;
    font-size:16px; font-weight:600; padding:14px 16px; cursor:pointer; }
  button:hover { filter:brightness(1.08); }
  .fine { margin-top:16px; font-size:13px; color:#94a3b8; }
</style></head>
<body>
  <form class="card" method="post" action="/api/auth/magic">
    <div class="mark">T</div>
    <h1>Confirm sign-in</h1>
    <p>Click below to securely sign in to your Telroi workspace.</p>
    <input type="hidden" name="token" value="${t}">
    <button type="submit">Sign in to Telroi</button>
    <div class="fine">Single-use link, expires shortly. If it has expired, request a new code from the login page.</div>
  </form>
</body></html>`;
});
