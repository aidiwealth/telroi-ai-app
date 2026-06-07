// GET /api/auth/magic?token=... -> verify, set cookie, redirect
import { verifyToken, establishSession } from '~/server/utils/auth-core';
import { rateLimit, clientIp } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  const token = getQuery(event).token as string | undefined;
  if (!token) return sendRedirect(event, '/login?error=missing_token');
  // Defence-in-depth: cap magic-link verification attempts per IP so the token
  // space can't be probed in bulk (tokens are high-entropy, but this is cheap).
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
