// GET /api/voice/my-session -> mint a Digitide login link for the CURRENT
// employee, using the operator key. This is how a Telroi employee jumps into
// their Digitide UI with no password: they auth to Telroi (magic link/OTP),
// and we exchange that for a Digitide session behind the scenes.
import { requireTenant, apiError } from '~/server/utils/api';
import { loadTenant } from '~/server/utils/tenant';
import { OperatorClient } from '~/server/utils/telroi/operator';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const tenant = await loadTenant(s.tenantId);
  if (!tenant.telroiDomain) throw apiError('no_domain', 'Workspace has no PBX domain', 409);

  const op = await OperatorClient.fromPlatform();
  // The employee's Digitide login is their email (the login we provision them with).
  try {
    return await op.userSession(tenant.telroiDomain, s.email);
  } catch (e: any) {
    throw apiError('session_failed', `Could not mint session: ${e?.message || e}`, 502);
  }
});
