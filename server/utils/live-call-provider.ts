// server/utils/live-call-provider.ts
// Resolves which voice provider powers a Live Call, and builds the dial intent
// the media bridge will execute. Selection rules:
//   1. Admin override (callProvider setting): digidite | telnyx | twilio
//   2. 'auto' (default): Nigeria -> digidite, everywhere else -> telnyx
// The resolved provider + creds-availability + dial params are returned and
// recorded on the call. The actual audio bridge runs on live infra.
import { eq, and, desc } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { masterCarrierCreds } from './platform';
import { provisionAgentConfigured } from './provision-agent';
import { isNigeria } from './countries';

export type VoiceProvider = 'digidite' | 'telnyx' | 'twilio' | 'asterisk';

export interface DialIntent {
  provider: VoiceProvider;
  ready: boolean;            // are credentials configured for this provider?
  fromNumber: string | null; // the tenant's assigned number this call dials from
  toRoute: any;              // team members / AI agent the call connects to
  reason: string;            // why this provider was chosen (for logs/debugging)
}

// Map our schema's provider naming: 'telroi' is our own Asterisk PBX.
function normalize(p: string): VoiceProvider {
  if (p === 'telroi' || p === 'digidite' || p === 'pbx' || p === 'asterisk' || p === 'ruach' || p === 'sotel' || p === 'kasooko') return 'telroi';
  if (p === 'telnyx') return 'telnyx';
  if (p === 'twilio') return 'twilio';
  return 'telnyx';
}

// The number a Live Call dials FROM: prefer a number assigned to the chosen
// team/department, else the tenant's first active number.
async function providerOfNumber(tenantId: string, telnum: string): Promise<VoiceProvider | null> {
  const db = useDb();
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.telnum, telnum)))
    .limit(1);
  return sub?.provider ? normalize(sub.provider) : null;
}

async function resolveFromNumber(tenantId: string, teamId?: string | null): Promise<{ telnum: string | null; provider: VoiceProvider | null }> {
  const db = useDb();
  if (teamId) {
    const [bytEam] = await db.select().from(schema.numberSubscriptions)
      .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.departmentId, teamId), eq(schema.numberSubscriptions.status, 'active')))
      .limit(1);
    if (bytEam) return { telnum: bytEam.telnum, provider: normalize(bytEam.provider) };
  }
  const [any] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.status, 'active')))
    .orderBy(desc(schema.numberSubscriptions.purchasedAt)).limit(1);
  return any ? { telnum: any.telnum, provider: normalize(any.provider) } : { telnum: null, provider: null };
}

export async function resolveLiveCallProvider(opts: {
  tenantId: string;
  configuredProvider?: string;   // from live_call settings (auto|digidite|telnyx|twilio)
  visitorCountry?: string | null;
  teamId?: string | null;
  toRoute?: any;
  preferredFromNumber?: string | null;  // explicit caller-ID (e.g. admin's per-region support number)
}): Promise<DialIntent> {
  const from = opts.preferredFromNumber
    ? { telnum: opts.preferredFromNumber, provider: await providerOfNumber(opts.tenantId, opts.preferredFromNumber) }
    : await resolveFromNumber(opts.tenantId, opts.teamId);

  // 1. Decide the provider.
  let provider: VoiceProvider;
  let reason: string;
  const cfg = (opts.configuredProvider || 'auto').toLowerCase();
  const ng = isNigeria(opts.visitorCountry);

  if (cfg === 'asterisk') {
    // Admin explicitly chose Asterisk (global).
    provider = 'asterisk'; reason = 'admin override (asterisk)';
  } else if (cfg === 'digidite' || cfg === 'telnyx' || cfg === 'twilio') {
    provider = cfg as VoiceProvider; reason = `admin override (${cfg})`;
  } else {
    // auto: Nigeria -> Digidite; non-NG -> Telnyx.
    // If the from-number's own provider is known, prefer that (number already on it).
    if (from.provider) { provider = from.provider; reason = `number's carrier (${from.provider})`; }
    else if (ng) { provider = 'digidite'; reason = 'auto: Nigeria -> Digidite'; }
    else { provider = 'telnyx'; reason = 'auto: non-Nigeria -> Telnyx'; }
  }

  // 2. Are credentials configured for it?
  let ready = false;
  try {
    const creds = await masterCarrierCreds();
    if (provider === 'digidite') ready = !!creds?.telroiPbx;
    else if (provider === 'telnyx') ready = !!creds?.telnyx;
    else if (provider === 'twilio') ready = !!creds?.twilio;
    else if (provider === 'asterisk') { const c = await voiceCredentials(); ready = !!c?.asterisk?.sipGateway; }
  } catch { ready = false; }

  return { provider, ready, fromNumber: from.telnum, toRoute: opts.toRoute || null, reason };
}
