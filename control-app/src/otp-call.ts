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

  const chan = client.Channel();
  await chan.originate({
    endpoint: `PJSIP/${dial}@${trunk}`,
    context: 'otp-play',
    extension: 's',
    priority: 1,
    callerId: opts.callerId || 'Telroi',
    timeout,
    variables: { CODE: code, REPEATS: String(repeats) }
  });

  log(`placed to ${dial} via ${trunk} (channel ${chan.id})`);
  return { callid: chan.id };
}
