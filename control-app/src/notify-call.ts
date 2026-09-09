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
}

export async function placeNotifyCall(opts: NotifyCallOptions): Promise<{ ok: boolean; callid?: string; reason?: string }> {
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

  const trunk = opts.trunk || 'ruach-endpoint';
  const host = opts.host || 'sip.ruach.ng';
  const timeout = opts.callTimeoutSec || 45;

  log(`originating to ${dial} via ${trunk}, ${text.length} chars`);
  const chan = client.Channel();
  try {
    await chan.originate({
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
        NOTIFY_CID: opts.callerId || ''
      }
    });
  } catch (e: any) {
    log(`originate failed: ${e?.message || e}`);
    // The audio is no use without a call, and a directory of orphaned speech
    // grows quietly until a disk fills.
    await fs.unlink(target).catch(() => {});
    return { ok: false, reason: 'originate_failed' };
  }

  return { ok: true, callid: chan.id };
}
