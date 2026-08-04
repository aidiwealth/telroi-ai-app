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
  chan.on('ChannelDestroyed' as any, (_e: any, c: any) => log(`channel ${chan.id} destroyed: ${c?.cause_txt || 'unknown'}`));
  log(`placed to ${dial} via ${trunk} (channel ${chan.id})`);
  return { callid: chan.id };
}
