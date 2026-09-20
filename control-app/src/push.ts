/**
 * Waking a handset so a call can ring it.
 *
 * A registered app is only reachable while it is running: both mobile platforms
 * suspend an app within seconds of it going to the background, and a suspended
 * app does not answer a SIP INVITE. So the phone is pushed first, and the push
 * is what brings the registration back before Asterisk dials.
 *
 * Android only. iOS needs PushKit and Apple's own VoIP certificate through
 * APNs, which is separate infrastructure rather than a flag on this — a second
 * sender alongside, when that enrolment clears.
 */
import { db, schema } from './db.ts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sendApns } from './apns.ts';

const SA = process.env.FCM_SERVICE_ACCOUNT || '';

let creds: { client_email: string; private_key: string; project_id: string } | null = null;
function serviceAccount() {
  if (creds) return creds;
  if (!SA) return null;
  try {
    creds = JSON.parse(Buffer.from(SA, 'base64').toString('utf8'));
    return creds;
  } catch {
    console.error('[push] FCM_SERVICE_ACCOUNT is not valid base64 JSON');
    return null;
  }
}

/**
 * An access token for FCM v1.
 *
 * The old server-key API is retired, so this signs a JWT with the service
 * account and exchanges it for a bearer token. Cached until shortly before it
 * expires: minting one per call would be a round trip to Google in the seconds
 * before a phone rings, which is the worst possible moment to spend them.
 */
let token: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (token && Date.now() < token.expires - 60_000) return token.value;
  const sa = serviceAccount();
  if (!sa) return null;

  const { createSign } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  })).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key, 'base64url');

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${sig}`
      }),
      signal: AbortSignal.timeout(8000)
    });
    const j: any = await res.json();
    if (!res.ok || !j.access_token) {
      console.error('[push] token exchange failed:', res.status, j.error_description || j.error);
      return null;
    }
    token = { value: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
    return token.value;
  } catch (e: any) {
    console.error('[push] token exchange error:', e?.message || e);
    return null;
  }
}

export interface IncomingPush {
  tenantId: string;
  /** Who should ring. Empty means everyone registered on the workspace. */
  userIds?: string[];
  callId: string;
  from: string;
  /** What to show as the caller. A push reaches a closed app before any INVITE,
   *  so CallKit displays this and nothing else — without it the app falls back
   *  to the number, which for a widget call is a SIP username. */
  fromName?: string;
  to: string;
}

/**
 * Wake the handsets that should ring for this call.
 *
 * Data-only, deliberately. A notification message is handled by the system and
 * may never reach our code; a data message with high priority is delivered to
 * TelroiMessagingService, which is the whole point — the app has to run before
 * it can register.
 *
 * Returns how many were reached, and never throws: a call must not fail because
 * a push did.
 */
export async function pushIncomingCall(p: IncomingPush): Promise<number> {
  const at = await accessToken();
  if (!at) return 0;

  const sa = serviceAccount();
  if (!sa) return 0;

  let rows: any[] = [];
  try {
    const conds: any[] = [
      eq(schema.userDevices.tenantId, p.tenantId),
      isNull(schema.userDevices.revokedAt),
      // Both platforms now. The sender is chosen per device below, since
      // Apple and Google share nothing beyond the idea of a push.
      inArray(schema.userDevices.platform, ['android', 'ios'])
    ];
    if (p.userIds?.length) conds.push(inArray(schema.userDevices.userId, p.userIds));
    rows = await db.select().from(schema.userDevices).where(and(...conds));
  } catch (e: any) {
    // A table missing from control-app/src/schema.ts reads as undefined and
    // fails here, which looked exactly like having no devices to wake. Named
    // so the next one is a minute rather than an afternoon.
    console.error('[push] could not read user_devices — is it declared in control-app/src/schema.ts?',
      e?.message || e);
    return 0;
  }
  if (!rows.length) return 0;

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  let sent = 0;

  await Promise.all(rows.map(async (d: any) => {
    // iOS goes to Apple, with the same four fields. PushKit requires the app to
    // report the call to CallKit almost immediately or the system kills it, so
    // caller and dialed travel in the push rather than being looked up.
    if (d.platform === 'ios') {
      const r = await sendApns(d.pushToken, d.environment || 'production', {
        type: 'incoming_call', callId: p.callId,
        // callerName beside caller: a push reaches a closed app before any
        // INVITE exists, so CallKit shows what this says and nothing else. The
        // app falls back to the number when it is absent, which is what a
        // recipient was seeing — a SIP username, or a bare number for somebody
        // whose name we knew.
        caller: p.from || '', callerName: p.fromName || '', dialed: p.to || ''
      });
      if (r.ok) { sent++; return; }
      console.error('[push] apns failed:', r.status || '', r.reason || '');
      // Only these two mean the handset is gone. Everything else is a bad
      // moment rather than a dead device, and deleting on those would clear
      // the table one call at a time.
      if (r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') {
        await db.delete(schema.userDevices).where(eq(schema.userDevices.id, d.id))
          .catch(() => {});
        console.log('[push] dropped an iOS token Apple no longer knows');
      }
      return;
    }

    const body = {
      message: {
        token: d.pushToken,
        // Enough to show the call before anything is fetched: the app has to
        // report it to the platform's calling framework straight away, and a
        // round trip first is time it does not have.
        // 'from' is reserved by FCM and rejects the whole message. Named
        // 'caller' instead — and 'to' renamed alongside it so the pair stay
        // legible together rather than one carrying a scar the other does not.
        data: {
          type: 'incoming_call',
          callId: p.callId,
          caller: p.from || '',
          callerName: p.fromName || '',
          dialed: p.to || ''
        },
        android: { priority: 'HIGH', direct_boot_ok: true }
      }
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) { sent++; return; }

      const j: any = await res.json().catch(() => null);
      const code = j?.error?.details?.[0]?.errorCode || j?.error?.status;
      // Always, rather than only on failures we did not expect. Reporting the
      // outcome alone made a rejected token and a malformed request look
      // identical from here, and the second was deleting handsets one call at
      // a time while looking like the first.
      console.error('[push] send failed:', res.status, code || '', j?.error?.message || '');
      // A reinstalled app issues a new token and abandons the old one. Left in
      // place it would be pushed to for ever, and the delivery rate would rot
      // quietly with nothing to show why.
      if (code === 'UNREGISTERED') {
        await db.delete(schema.userDevices).where(eq(schema.userDevices.id, d.id))
          .catch(() => {});
        console.log('[push] dropped a dead token for tenant', p.tenantId);
      } else {
        console.error('[push] send failed:', res.status, code || '');
      }
    } catch (e: any) {
      console.error('[push] send error:', e?.message || e);
    }
  }));

  if (sent) console.log(`[push] woke ${sent} of ${rows.length} device(s) for ${p.callId}`);
  return sent;
}
