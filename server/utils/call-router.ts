// server/utils/call-router.ts
// Routes an outbound call to the correct carrier based on the FROM number's
// provisioned provider. The number already exists on the carrier's side (admin
// provisioned it on Telroi's MASTER account), so we just pass it through.
//
// Routes, each with its own MASTER credentials held by Telroi (the platform) —
// never per-tenant:
//   'telroi'   -> Telroi's own customized Digidite PBX (its subdomain + key)
//   'twilio'   -> Twilio master account
//   'telnyx'   -> Telnyx master account
//   'asterisk' -> Core Asterisk SIP trunk + ARI (global)
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { apiError } from './api';
import { masterCarrierCreds } from './platform';
import { twilio, telnyx } from './providers';

export interface PlaceCallArgs {
  tenantId: string;
  fromTelnum: string;
  to: string;
  user?: string;
  group?: string;
}

async function providerForNumber(tenantId: string, telnum: string): Promise<string | null> {
  const db = useDb();
  // Prefer a subscription the tenant holds; fall back to the inventory record
  // (admin support numbers may be provisioned in inventory without a subscription).
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.telnum, telnum), eq(schema.numberSubscriptions.tenantId, tenantId)))
    .limit(1);
  if (sub?.provider) return sub.provider;
  const [inv] = await db.select().from(schema.numberInventory)
    .where(eq(schema.numberInventory.telnum, telnum)).limit(1);
  return inv?.provider || null;
}

export async function placeCall(args: PlaceCallArgs) {
  const provider = await providerForNumber(args.tenantId, args.fromTelnum);
  if (!provider) throw apiError('not_owned', 'That number is not on your account', 400);

  const master = await masterCarrierCreds();
  if (!master) throw apiError('not_configured', 'No master carrier credentials configured', 503);
  const base = useRuntimeConfig().public.appBaseUrl;

  switch (provider) {
    case 'telroi': {
      // Telroi Voice — our OWN Asterisk PBX. Origination runs via the control-app
      // agent (rings the agent's device, dials the destination out through the
      // region's trunk, bridges them).
      const { AsteriskClient } = await import('./telroi/asterisk-client');
      const client = AsteriskClient.forTenant({ id: args.tenantId });
      return await client.makeCall({ phone: args.to, user: args.user, group: args.group, clid: args.fromTelnum });
    }
    case 'ruach':
    case 'sotel': {
      // Ruach / Sotel — NG SIP trunks that live as routes on our OWN Asterisk PBX.
      // Same PBX origination path as 'telroi', but the destination leg goes out
      // the carrier's trunk endpoint. The from-number is presented as caller ID
      // (it's the customer's purchased DID on that carrier).
      const { AsteriskClient } = await import('./telroi/asterisk-client');
      const client = AsteriskClient.forTenant({ id: args.tenantId });
      const trunk = provider === 'ruach' ? 'ruach-endpoint' : 'sotel-endpoint';
      return await client.makeCall({ phone: args.to, user: args.user, group: args.group, clid: args.fromTelnum, trunk });
    }
    case 'twilio': {
      if (!master.twilio) throw apiError('no_carrier', 'Twilio master account is not configured', 503);
      return await twilio.makeCall({ ...master.twilio, fromNumber: args.fromTelnum }, args.to, `${base}/api/webhooks/twilio/voice`);
    }
    case 'telnyx': {
      if (!master.telnyx) throw apiError('no_carrier', 'Telnyx master account is not configured', 503);
      return await telnyx.makeCall({ ...master.telnyx, fromNumber: args.fromTelnum }, args.to);
    }
    case 'asterisk': {
      // Core Asterisk: global, IP-authenticated SIP trunk on a separate server,
      // with an optional AMI/ARI REST API. Origination runs on the live Asterisk
      // server; here we build the dial intent it executes. Control-plane only —
      // actual audio bridges on live infra.
      if (!(master as any).asterisk || !(master as any).asterisk.sipGateway) throw apiError('no_carrier', 'Asterisk SIP trunk is not configured', 503);
      const a = (master as any).asterisk;
      return {
        provider: 'asterisk',
        status: 'originating',
        dial: {
          to: args.to,
          from: args.fromTelnum,
          sipGateway: a.sipGateway,
          sipPort: a.sipPort || 5060,
          transport: a.transport || 'udp',
          sipDomain: a.sipDomain || a.sipGateway,
          authUser: a.authUser || '',
          authPass: a.authPass || '',
          // API origination details (ARI) when present; the bridge may use these
          // instead of raw SIP signaling.
          apiBaseUrl: a.apiBaseUrl || '',
          ariAppName: a.ariAppName || ''
        }
      };
    }
    default:
      throw apiError('unsupported', `Unknown provider ${provider}`, 400);
  }
}
