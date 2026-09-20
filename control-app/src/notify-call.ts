// control-app/src/notify-call.ts
// Place a voice notification: dial the destination and speak the client's text.
//
// Shaped like otp-call.ts, with one difference that shapes everything else. OTP
// reads digits from files that already exist, so nothing is prepared per call
// and a hundred thousand of them cost only carrier minutes. A notification says
// something different every time, so it is synthesised first and the call plays
// one file — which means the audio must exist, be readable by Asterisk, and be
// cleaned up afterwards.
//
// The synthesis path is the one whispers already use: the web app holds the
// vendor credentials and returns audio, and sox converts it to the 8kHz mono
// WAV Asterisk plays.
import type Ari from 'ari-client';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

const NOTIFY_TMP = process.env.NOTIFY_TMP_DIR || '/var/lib/asterisk/sounds/telroi-notify';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[notify-call]', ...args);
}

export interface NotifyCallOptions {
  client: Ari.Client;
  to: string;
  text: string;
  notificationId: string;
  tenantId: string;
  trunk?: string;
  host?: string;
  callerId?: string;
  callTimeoutSec?: number;
  carrier?: string;
  sipEndpoint?: string;
}

export async function placeNotifyCall(opts: NotifyCallOptions): Promise<{ ok: boolean; callid?: string; reason?: string; durationSeconds?: number }> {
  const { client, to, text, notificationId, tenantId } = opts;
  const dial = String(to || '').replace(/[^0-9]/g, '');
  if (!dial) return { ok: false, reason: 'no_destination' };

  // Synthesised before dialling, because the dialplan plays a file rather than
  // speaking into a live channel. A call placed first would answer to silence
  // while we waited for a vendor.
  const { synthesizeMessage } = await import('./bridge.ts');
  const media = await synthesizeMessage(text, tenantId).catch(() => null);
  if (!media) return { ok: false, reason: 'synthesis_failed' };

  // Asterisk plays by name relative to its sounds directory and without the
  // extension, so the file is moved somewhere predictable and referred to the
  // way the dialplan expects.
  const name = `notify-${randomUUID()}`;
  const target = `${NOTIFY_TMP}/${name}.wav`;
  try {
    await fs.mkdir(NOTIFY_TMP, { recursive: true });
    await fs.copyFile(media.replace(/^sound:/, '') + (media.endsWith('.wav') ? '' : '.wav'), target);
    // Asterisk reads as the asterisk user, and this process does not run as it.
    // A root-owned file plays as silence: Playback returns immediately, the
    // dialplan hangs up, and the call drops a second after answering — which
    // looks like a carrier fault and is not one.
    try {
      const uid = Number(execSync('id -u asterisk').toString().trim());
      const gid = Number(execSync('id -g asterisk').toString().trim());
      await fs.chown(target, uid, gid);
      await fs.chmod(target, 0o644);
    } catch { /* usually still readable; the call matters more than the mode */ }
  } catch (e: any) {
    log(`could not stage audio: ${e?.message || e}`);
    return { ok: false, reason: 'audio_staging_failed' };
  }

  // The duration gate. This interval — after synthesis, before dialling — is
  // the entire reason the unit model works: the cheap leg has been spent and
  // the expensive one has not, and the audio can be measured rather than
  // estimated. Characters are predictable; seconds are what cost us; and on a
  // numeral-dense alert the two diverge by a factor of four.
  let durationSeconds = 0;
  try {
    durationSeconds = Number(execSync(`soxi -D ${JSON.stringify(target)}`).toString().trim()) || 0;
  } catch (e: any) {
    // Not fatal. An unmeasured call bills on characters alone, which is the
    // old behaviour rather than a wrong one.
    log(`could not measure audio: ${e?.message || e}`);
  }

  // A message this long is almost certainly a malformed template or a failed
  // merge field rather than traffic anybody meant to send. Refused before
  // dialling: the synthesis is spent either way, the carriage need not be.
  if (durationSeconds > 60) {
    log(`refusing ${Math.round(durationSeconds)}s of audio — above the 60s ceiling`);
    await fs.unlink(target).catch(() => {});
    return { ok: false, reason: 'audio_too_long', durationSeconds };
  }
  // Flagged rather than charged for: a single long message is variance, and a
  // customer whose whole traffic pattern is numeral-dense is the thing worth
  // seeing before it becomes a pattern.
  if (durationSeconds > 20) {
    log(`review: ${Math.round(durationSeconds)}s of audio for notification ${notificationId}`);
  }

  const trunk = opts.trunk || 'ruach-endpoint';
  const host = opts.host || 'sip.ruach.ng';
  const timeout = opts.callTimeoutSec || 45;

  log(`originating to ${dial} via ${trunk}, ${text.length} chars`);
  const chan = client.Channel();
  try {
    await chan.originate({
      // E.164 with the plus for the international trunks, digits alone for the
      // Nigerian ones. Ruach's switch returned 500 on a leading plus and
      // accepted the same number without it; Telnyx and Twilio want it. One
      // format for both would fail on whichever was not chosen.
      // Digits, no plus — the form the carrier dialplans use and the one that
      // routes. Adding a plus for the international trunks was a guess, and the
      // working Telnyx context does not use one.
      endpoint: `PJSIP/${trunk}/sip:${dial}@${host}:5060`,
      context: 'notify-out',
      extension: 's',
      priority: 1,
      callerId: opts.callerId || 'Telroi',
      timeout,
      variables: {
        NOTIFY_ID: notificationId,
        // An absolute path without the extension. A bare name is resolved
        // against Asterisk's own sounds directory, which is not where we stage
        // — so it looked for a file that was never going to be there, returned
        // immediately, and the call dropped a second after answering.
        NOTIFY_MEDIA: `${NOTIFY_TMP}/${name}`,
        NOTIFY_DEST: dial,
        NOTIFY_TRUNK: trunk,
        NOTIFY_HOST: host,
        NOTIFY_CID: opts.callerId || '',
        NOTIFY_CARRIER: opts.carrier || '',
        NOTIFY_ENDPOINT: opts.sipEndpoint || ''
      }
    });
  } catch (e: any) {
    log(`originate failed: ${e?.message || e}`);
    // The audio is no use without a call, and a directory of orphaned speech
    // grows quietly until a disk fills.
    await fs.unlink(target).catch(() => {});
    return { ok: false, reason: 'originate_failed' };
  }

  return { ok: true, callid: chan.id, durationSeconds };
}
