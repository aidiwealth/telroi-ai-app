// server/middleware/00.security-headers.ts
// Defense-in-depth HTTP security headers on every response.
// Kept deliberately compatible with the app's needs:
//   - the in-browser dialer loads WebRTC SDKs from CDNs (Twilio/Telnyx/jsDelivr/unpkg/cloudflare)
//   - the docs/status pages use inline styles
// so the CSP allows those sources rather than breaking real features. Tighten
// further once a nonce-based inline-script strategy is in place.
export default defineEventHandler((event) => {
  const path = event.path || '';
  // Don't set HTML security headers on API/webhook JSON responses (not needed,
  // and CSP/frame rules are about documents). Still set nosniff everywhere.
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin');
  setHeader(event, 'X-Frame-Options', 'SAMEORIGIN'); // clickjacking protection
  setHeader(event, 'Permissions-Policy', 'geolocation=(), camera=(), microphone=(self), payment=()');

  // HSTS only in production over HTTPS.
  if (process.env.NODE_ENV === 'production') {
    setHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content-Security-Policy for document (HTML) responses only. Most /api/ and
  // /v1/ routes return JSON, but /api/docs is an HTML page — so key off the
  // actual JSON data endpoints rather than a blanket /api/ prefix.
  const isJsonApi = (path.startsWith('/api/') && path !== '/api/docs') || path.startsWith('/v1/');
  if (!isJsonApi) {
    const csp = [
      "default-src 'self'",
      // Inline styles are used by the app; allow them. WebRTC SDKs load from these CDNs.
      "script-src 'self' 'unsafe-inline' https://sdk.twilio.com https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      // WebRTC + API + websocket signaling for the dialer + booking/intercom widgets.
      "connect-src 'self' https: wss:",
      "media-src 'self' blob:",
      "frame-src 'self' https://cal.com https://app.cal.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ');
    setHeader(event, 'Content-Security-Policy', csp);
  }
});
