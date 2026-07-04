// server/utils/platform.ts
// Guard for platform-admin (boss) endpoints. Platform admins are a separate
// identity space from tenant users; their session carries a `platform` claim.
import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { readAdminSession, refreshAdminSession } from './session';
import { apiError } from './api';
import { useDb, schema } from '../db';

export async function requirePlatformAdmin(event: H3Event) {
  const s = await readAdminSession(event);
  if (!s?.email) throw apiError('unauthorized', 'Operator authentication required', 401);
  const db = useDb();
  const [admin] = await db.select().from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.email, s.email)).limit(1);
  if (!admin) throw apiError('forbidden', 'Platform admin access required', 403);
  // Rolling idle timeout: reset the 30-min window on each authenticated request.
  try { await refreshAdminSession(event, { email: admin.email, role: admin.role }); } catch { /* non-fatal */ }
  return { email: admin.email, role: admin.role };
}

// Guard for areas restricted to superadmins (App releases, Settings, Pricing).
// Staff operators are blocked from viewing AND changing these — a 403 either way.
export async function requireSuperAdmin(event: H3Event) {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'This area is restricted to superadmins.', 403);
  return admin;
}

export async function isPlatformAdmin(email: string): Promise<boolean> {
  const db = useDb();
  const [a] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)).limit(1);
  return !!a;
}

// Which platform-admin roles may place outbound support calls. Calls spend the
// support wallet and reach customers, so this is an explicit allowlist rather
// than "any admin" — add 'support'/exclude a future 'viewer' role here in one
// place. Today both working roles (superadmin, staff) may call; a read-only
// role added later simply isn't listed and is therefore denied.
const SUPPORT_CALL_ROLES = ['superadmin', 'staff'] as const;

/** Guard: require a platform admin whose role is allowed to place support calls. */
export async function requireSupportCaller(event: H3Event) {
  const admin = await requirePlatformAdmin(event);
  if (!(SUPPORT_CALL_ROLES as readonly string[]).includes(admin.role)) {
    throw apiError('forbidden', 'Your role can’t place support calls.', 403);
  }
  return admin;
}

// ── Master carrier credentials (platform-level) ──
// All carriers are Telroi's own master accounts, never per-tenant. The Telroi
// default PBX is Telroi's customized Digitide account (its own subdomain + key).
import { decrypt } from './crypto';

export async function platformSettings() {
  const db = useDb();
  const [row] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  return row || null;
}

export async function masterCarrierCreds() {
  const s = await platformSettings();
  if (!s) return null;
  // Digidite (Telroi PBX) is the same account as the operator credential by
  // default. Use the explicit PBX override if set; otherwise fall back to the
  // operator domain/key — one Digidite account serves both provisioning and the
  // NG carrier route.
  const pbx = s.telroiPbxDomain && s.telroiPbxKeyEnc
    ? { domain: s.telroiPbxDomain, apiKey: decrypt(s.telroiPbxKeyEnc) }
    : (s.operatorDomain && s.operatorApiKeyEnc
        ? { domain: s.operatorDomain, apiKey: decrypt(s.operatorApiKeyEnc) } : null);
  return {
    telroiPbx: pbx,
    twilio: s.twilioCredsEnc ? JSON.parse(decrypt(s.twilioCredsEnc)) : null,
    telnyx: s.telnyxCredsEnc ? JSON.parse(decrypt(s.telnyxCredsEnc)) : null,
    asterisk: s.asteriskVoiceCredsEnc ? JSON.parse(decrypt(s.asteriskVoiceCredsEnc)) : null,
  };
}

// Resolve the active payment-provider keys based on paymentMode (test|live).
// Falls back to env vars when nothing is stored in settings. If a tenantId is
// given and that tenant has a paymentProviderOverride, the result also reports
// the forced provider so callers can route that client to a specific gateway.
export async function paymentCreds(tenantId?: string) {
  const s = await platformSettings();
  const cfg = useRuntimeConfig() as any;
  const mode = (s?.paymentMode as 'test' | 'live') || 'test';
  const pick = (liveEnc?: string | null, testEnc?: string | null) => {
    const enc = mode === 'live' ? liveEnc : testEnc;
    if (enc) { try { return decrypt(enc); } catch { return null; } }
    return null;
  };
  const stripe = pick(s?.stripeLiveEnc, s?.stripeTestEnc) || cfg.stripeSecretKey || null;
  const paystack = pick(s?.paystackLiveEnc, s?.paystackTestEnc) || cfg.paystackSecretKey || null;
  const monnifyRaw = pick(s?.monnifyLiveEnc, s?.monnifyTestEnc);
  let monnify: any = null;
  if (monnifyRaw) { try { monnify = JSON.parse(monnifyRaw); } catch { monnify = null; } }
  else if (cfg.monnifyApiKey && cfg.monnifySecretKey) monnify = { apiKey: cfg.monnifyApiKey, secretKey: cfg.monnifySecretKey, contractCode: cfg.monnifyContractCode };

  let override: string | null = null;
  if (tenantId) {
    const db = useDb();
    const [t] = await db.select({ ov: schema.tenants.paymentProviderOverride }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    override = t?.ov || null;
  }
  return { mode, stripe, paystack, monnify, override };
}
