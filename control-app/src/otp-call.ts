// control-app/src/otp-call.ts
// Place a voice OTP: dial the destination and read the code to whoever answers.
//
// Simpler than originate.ts — there is no agent and no bridge. One leg out
// through a carrier trunk, landing in the otp-play dialplan context, which
// answers, plays our recorded line and reads the digits with SayDigits. No
// synthesis per call: the phrase is a file and the digits are Asterisk's own,
// so a hundred thousand calls a day cost nothing beyond the carrier minutes.
// The code never leaves the machine — it is spoken from local sound files.
import type Ari from 'ari-client';
import { reportOtpStatus } from './call-log.ts';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[otp-call]', ...args);
}

export interface OtpCallOptions {
  client: Ari.Client;
  to: string;
  code: string;
  trunk: string;
  prefix?: string;
  host?: string;           // carrier SIP host, e.g. sip.ruach.ng
  callerId?: string;
  repeatCount?: number;
  timeoutSec?: number;
  otpId?: string;          // ours, so the hangup can be reported against the row
}

export async function placeOtpCall(opts: OtpCallOptions): Promise<{ callid: string }> {
  const { client, to, code, trunk } = opts;
  const repeats = Math.max(1, Math.min(opts.repeatCount ?? 2, 5));
  const timeout = Math.max(15, Math.min(opts.timeoutSec ?? 45, 120));

  // The dialplan patterns match digits only — a leading + finds no route.
  const digits = String(to).replace(/[^0-9]/g, '');
  const dial = `${opts.prefix || ''}${digits}`;

  // The carrier dialplan uses PJSIP/<endpoint>/sip:<number>@<host> — endpoint
  // first, then a full URI. PJSIP/<number>@<endpoint> is a different form and
  // routes nowhere, which is why the first attempts originated cleanly and no
  // phone rang.
  log(`originating to ${dial} via ${trunk} callerId ${opts.callerId || '(none)'}`);
  const chan = client.Channel();
  await chan.originate({
    // The form the carrier dialplan uses, which is the one that routes — and the
    // answered leg lands in otp-out rather than Stasis, because an originated
    // channel with app=telroi never arrived there.
    endpoint: `PJSIP/${trunk}/sip:${dial}@${opts.host || 'sip.ruach.ng'}:5060`,
    context: 'otp-out',
    extension: 's',
    priority: 1,
    callerId: opts.callerId || 'Telroi',
    timeout,
    variables: {
      // The h extension reports the outcome against this, so the row can say
      // whether anyone actually heard the code rather than only that we dialled.
      OTP_ID: opts.otpId || '',
      CODE: code,
      REPEATS: String(repeats),
      OTP_DEST: dial,
      OTP_TRUNK: trunk,
      OTP_HOST: opts.host || 'sip.ruach.ng',
      OTP_CID: opts.callerId || ''
    }
  });

  // ARI resolves as soon as it accepts the request; the channel can still fail
  // afterwards, which is why success here has meant silent phones.
  chan.on('StasisStart' as any, () => log(`channel ${chan.id} entered Stasis`));

  // Report how the call actually ended. The row was marked delivered the moment
  // we dialled, so a number that rang unanswered read the same as one where
  // somebody wrote the code down — and delivery rate is the figure a client
  // judges an OTP service by.
  //
  // This lives here rather than in the dialplan because neither an h extension
  // nor a pushed hangup handler fires on a channel originated this way: both were
  // registered, both were silent. Whether the code was heard is inferred from
  // duration — the script runs about twenty-five seconds, so anything past
  // fifteen has had a full reading. That errs towards understating delivery,
  // which is the safer direction for a number a client checks against their own.
  const placedAt = Date.now();
  chan.on('ChannelDestroyed' as any, (_e: any, c: any) => {
    const seconds = Math.round((Date.now() - placedAt) / 1000);
    const cause = Number(c?.cause || 0);
    const causeTxt = c?.cause_txt || 'unknown';
    const status = seconds >= 15 ? 'delivered'
      : cause === 17 ? 'busy'
      : cause === 18 || cause === 19 ? 'no_answer'
      : cause === 21 ? 'rejected'
      : cause === 16 ? 'no_answer'
      : 'failed';
    log(`channel ${chan.id} destroyed after ${seconds}s: ${causeTxt} -> ${status}`);
    if (opts.otpId) {
      void reportOtpStatus(opts.otpId, status, seconds)
        .catch((e) => log(`otp ${opts.otpId} status not recorded: ${(e as Error)?.message}`));
    }
  });
  log(`placed to ${dial} via ${trunk} (channel ${chan.id})`);
  return { callid: chan.id };
}
