// POST /api/auth/magic  { token } -> verify, set cookie, redirect.
//
// The consuming half of the magic link, split out from the GET so email link
// scanners (GET-only) can't burn a single-use token before the person clicks.
// The token itself is the high-entropy secret, so no CSRF token is needed: a
// forged POST would already have to possess the victim's one-time token.
import { verifyToken, establishSession } from '~/server/utils/auth-core';
import { rateLimit, clientIp } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({} as any));
  const token = ((body && body.token) || getQuery(event).token) as string | undefined;
  if (!token) return sendRedirect(event, '/login?error=missing_token');

  // Cap verification attempts per IP so the token space can't be probed in bulk.
  try { rateLimit('auth_magic_ip', clientIp(event), 40, 15 * 60 * 1000); }
  catch { return sendRedirect(event, '/login?error=rate_limited'); }

  try {
    const email = await verifyToken(token);
    const { hasTenant } = await establishSession(event, email);
    return sendRedirect(event, hasTenant ? '/' : '/onboarding');
  } catch {
    return sendRedirect(event, '/login?error=invalid_token');
  }
});
