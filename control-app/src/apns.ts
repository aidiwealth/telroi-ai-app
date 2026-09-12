/**
 * Waking an iPhone so a call can ring it.
 *
 * A second sender rather than a flag on the FCM one: PushKit is Apple's own
 * infrastructure, with its own certificate, its own hosts and its own rules
 * about what a push must do when it lands.
 *
 * The strictest of those rules shapes everything here: iOS requires the app to
 * report the call to CallKit almost immediately, or it kills the app and stops
 * delivering VoIP pushes to it. So the payload carries caller and dialed rather
 * than an id to look up — the app has no time for a round trip.
 */
import { connect, constants } from 'node:http2';

const PEM = process.env.APNS_CERT_PEM || '';
const BUNDLE = process.env.APNS_BUNDLE_ID || 'ai.telroi.app';

// Apple keeps two entirely separate hosts, and a token belongs to exactly one.
// A TestFlight token sent to production is refused as BadDeviceToken, which
// reads as a handset that has gone rather than a message sent to the wrong
// place — so devices tell us which build they are and we route by it.
const HOSTS: Record<string, string> = {
  production: 'https://api.push.apple.com:443',
  sandbox: 'https://api.sandbox.push.apple.com:443'
};

let cert: string | null = null;
function credential(): string | null {
  if (cert) return cert;
  if (!PEM) return null;
  try {
    cert = Buffer.from(PEM, 'base64').toString('utf8');
    return cert;
  } catch {
    console.error('[apns] APNS_CERT_PEM is not valid base64');
    return null;
  }
}

export interface ApnsResult {
  ok: boolean;
  /** Apple's own reason, when it refuses. Worth carrying: BadDeviceToken and
   *  Unregistered mean different things and only one justifies deleting a row. */
  reason?: string;
  status?: number;
}

/**
 * One push, to one handset.
 *
 * A connection per send rather than a pooled one. Apple would rather we kept a
 * connection open, and at volume we should — but a pool that goes stale sends
 * nothing and says nothing, and a call that does not ring is worse than a
 * connection we opened twice.
 */
export async function sendApns(
  token: string,
  environment: string,
  payload: Record<string, string>
): Promise<ApnsResult> {
  const pem = credential();
  if (!pem) return { ok: false, reason: 'no_certificate' };

  const host = HOSTS[environment] || HOSTS.production;

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: ApnsResult) => { if (!settled) { settled = true; resolve(r); } };

    const client = connect(host, { cert: pem, key: pem });
    client.on('error', (e: any) => {
      console.error('[apns] connection error:', e?.message || e);
      done({ ok: false, reason: 'connect_failed' });
    });

    const body = JSON.stringify(payload);
    const req = client.request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      // voip, not alert. An alert push is shown by the system and may never
      // reach our code; a voip push wakes the app to run, which is the only
      // reason to send one.
      'apns-push-type': 'voip',
      // The bundle id with .voip appended: the certificate is issued for the
      // VoIP topic rather than the app's own, and Apple refuses a mismatch.
      'apns-topic': `${BUNDLE}.voip`,
      'apns-priority': '10',
      // Ten seconds. A wake-up that arrives after the caller has given up is
      // worse than none, since the phone rings at nobody.
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 10),
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body)
    });

    let status = 0;
    let raw = '';
    req.on('response', (h) => { status = Number(h[':status']) || 0; });
    req.on('data', (c) => { raw += c; });
    req.on('error', (e: any) => {
      console.error('[apns] request error:', e?.message || e);
      done({ ok: false, reason: 'request_failed' });
    });
    req.on('end', () => {
      client.close();
      if (status === 200) return done({ ok: true, status });
      let reason = '';
      try { reason = JSON.parse(raw)?.reason || ''; } catch { /* not json */ }
      done({ ok: false, status, reason: reason || `http_${status}` });
    });

    req.setTimeout(5000, () => {
      console.error('[apns] timed out');
      done({ ok: false, reason: 'timeout' });
      try { req.close(); client.close(); } catch { /* already gone */ }
    });

    req.end(body);
  });
}
