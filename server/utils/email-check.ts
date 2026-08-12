// server/utils/email-check.ts
// Does this address stand a chance of receiving anything?
//
// Zod checks the shape, which admits @gmail.con and @google.xx — and every one
// of those costs a send before failing silently. An MX lookup answers the cheap
// half of the question in a few milliseconds: does the domain accept mail at
// all. Whether the mailbox exists is a different question, answerable only by
// SMTP probing, which is slow, often blocked, and not worth it.
import { promises as dns } from 'node:dns';

// Addresses that work but are meant to be thrown away. Not fraud, but somebody
// who will never read the OTP they asked for.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com'
]);

// The ones people mistype. Worth naming the correction rather than a generic
// refusal — somebody who typed .con meant .com and will thank you for saying so.
const TYPOS: Record<string, string> = {
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com', 'gmail.cm': 'gmail.com', 'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com'
};

export interface EmailCheck { ok: boolean; reason?: string; suggestion?: string }

export async function checkEmailDeliverable(email: string): Promise<EmailCheck> {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return { ok: false, reason: 'That does not look like an email address.' };

  const fix = TYPOS[domain];
  if (fix) return { ok: false, reason: `Did you mean @${fix}?`, suggestion: fix };

  if (DISPOSABLE.has(domain)) {
    return { ok: false, reason: 'Please use a permanent email address — a temporary one will not receive your code.' };
  }

  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      // A slow resolver should not hold up a login. Two seconds is generous for
      // a DNS answer, and failing open is right: a real address behind a slow
      // lookup matters more than a fake one getting through.
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
    ]);
    if (!mx?.length) return { ok: false, reason: 'That domain does not accept email. Check the spelling and try again.' };
    return { ok: true };
  } catch (e: any) {
    if (e?.code === 'ENOTFOUND' || e?.code === 'ENODATA') {
      return { ok: false, reason: 'That domain does not accept email. Check the spelling and try again.' };
    }
    // Timeouts and resolver trouble fail open — the rate limits remain.
    return { ok: true };
  }
}
