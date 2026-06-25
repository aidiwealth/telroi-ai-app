// POST /api/voice/sip/provision -> set up SIP for this client. The SERVER picks
// the carrier (first vendor available to the client by region/creds/override);
// the client never chooses or sees a vendor. Owner/admin only. Returns the
// generic, vendor-neutral connection details + any one-time password.
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { availableSipVendors } from '~/server/utils/sip';
import { masterCarrierCreds, platformSettings } from '~/server/utils/platform';
import { twilio, telnyx } from '~/server/utils/providers';
import { encrypt, randomToken } from '~/server/utils/crypto';
import { agentProvision, provisionAgentConfigured } from '~/server/utils/provision-agent';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  // Only owners/admins of the workspace may provision billable SIP resources.
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can set up SIP.', 403);
  }

  // Server-side vendor selection — the client doesn't get a say. Prefer the
  // first vendor available for this client (region ∩ creds ∩ admin override).
  const { vendors } = await availableSipVendors(s.tenantId);
  if (!vendors.length) throw apiError('sip_unavailable', 'SIP isn’t available for your account yet.', 403);
  const vendor = vendors[0].id;

  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const creds = await masterCarrierCreds();
  const label = `${tenant?.slug || 'workspace'}-sip`;

  let row: any; let oneTimeSecret: string | null = null;

  if (vendor === 'twilio') {
    if (!creds?.twilio) throw apiError('not_configured', 'Twilio is not configured on the platform.', 503);
    const domainLabel = (tenant?.slug || 'tlr').replace(/[^a-z0-9-]/gi, '').toLowerCase() + '-' + Math.random().toString(36).slice(2, 7);
    const trunk = await twilio.createSipTrunk(creds.twilio, label, domainLabel);
    // Mint username/password device auth and attach it to the trunk so SIP
    // devices can authenticate. Password shown once, stored encrypted.
    const username = `${(tenant?.slug || 'tlr').replace(/[^a-z0-9]/gi, '')}_${Math.random().toString(36).slice(2, 6)}`;
    const password = randomToken(18);
    await twilio.createTrunkCredential(creds.twilio, trunk.sid, `${label}-creds`, username, password);
    oneTimeSecret = password;
    [row] = await db.insert(schema.sipEndpoints).values({
      tenantId: s.tenantId, provider: 'twilio', kind: 'trunk',
      externalId: trunk.sid, label, sipUsername: username,
      secretEnc: encrypt(password),
      domain: trunk.domainName, meta: { secure: trunk.secure }
    }).returning();
  } else if (vendor === 'telnyx') {
    if (!creds?.telnyx) throw apiError('not_configured', 'Telnyx is not configured on the platform.', 503);
    // Reuse this tenant's existing Telnyx connection if we've already made one;
    // otherwise create it. Then mint a fresh device credential on it.
    const [existing] = await db.select().from(schema.sipEndpoints)
      .where(and(eq(schema.sipEndpoints.tenantId, s.tenantId), eq(schema.sipEndpoints.provider, 'telnyx'))).limit(1);
    let connId = existing?.externalId || null;
    if (!connId) {
      const conn = await telnyx.createCredentialConnection(creds.telnyx, label);
      connId = conn.id;
    }
    const cred = await telnyx.createTelephonyCredential(creds.telnyx, connId!, `${label}-device`);
    oneTimeSecret = cred.sipPassword || null;
    [row] = await db.insert(schema.sipEndpoints).values({
      tenantId: s.tenantId, provider: 'telnyx', kind: 'credential_connection',
      externalId: connId, label, sipUsername: cred.sipUsername,
      secretEnc: oneTimeSecret ? encrypt(oneTimeSecret) : null,
      domain: 'sip.telnyx.com', meta: { credentialId: cred.id }
    }).returning();
  } else if (vendor === 'telroi' || vendor === 'asterisk') {
    if (!provisionAgentConfigured()) {
      throw apiError('sip_manual', 'SIP setup for your account is handled by our team — contact support to enable it.', 409);
    }
    const result = await agentProvision(s.tenantId, label);
    oneTimeSecret = result.password;
    [row] = await db.insert(schema.sipEndpoints).values({
      tenantId: s.tenantId, provider: 'telroi', kind: 'registration',
      externalId: result.username, label, sipUsername: result.username,
      secretEnc: encrypt(result.password),
      domain: result.domain, meta: { transport: result.transport, context: result.context }
    }).returning();
  } else {
    throw apiError('sip_manual', 'SIP setup for your account is handled by our team — contact support to enable it.', 409);
  }

  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.provision', summary: `Provisioned SIP endpoint (${vendor})` });

  // Vendor-neutral response: a Telroi-branded server host (masked if a proxy is
  // configured), the username, and the one-time password. No carrier identity.
  const settings = await platformSettings().catch(() => null);
  const sipServer = settings?.sipProxyDomain || row.domain || null;

  return {
    ok: true,
    endpoint: {
      id: row.id,
      sipServer,
      sipUsername: row.sipUsername || null,
      hasPassword: !!oneTimeSecret
    },
    // Returned ONCE — the client must copy it now; we store it encrypted.
    oneTimeSecret
  };
});
