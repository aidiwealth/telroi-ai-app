// server/utils/prembly.ts
// NIN verification through Prembly.
//
// Two things shape this. Each lookup costs us money, so a number already
// verified for a workspace is never looked up twice and attempts are capped —
// somebody retyping a typo four times should not cost four lookups. And the
// response carries a residential address and a photograph of a citizen: we read
// the name, keep the reference, and discard the rest rather than take on a duty
// of care nobody asked us for.
import { platformSettings } from './platform';
import { decrypt } from './crypto';

const ENDPOINT = 'https://api.prembly.com/verification/vnin-basic';

export interface NinResult {
  ok: boolean;
  reason?: string;
  reference?: string;
  name?: string;        // as NIMC holds it
  matched?: boolean;
}

/** Do these refer to the same person?
 *
 *  Not string equality: Nigerian names arrive in different orders, middle names
 *  come and go, and NIMC upper-cases everything. Surname plus one other name is
 *  the test — strict enough that a different person fails, forgiving enough that
 *  "Grace Amanda" matches "AMANDA GRACE CHIMAMANDA".
 */
export function namesMatch(claimed: string, official: string[]): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((p) => p.length > 1);
  const mine = new Set(norm(claimed));
  const theirs = official.flatMap((o) => norm(o || ''));
  if (!mine.size || !theirs.length) return false;
  const overlap = theirs.filter((t) => mine.has(t));
  return overlap.length >= 2;
}

export async function verifyNin(nin: string, claimedName: string): Promise<NinResult> {
  const ps: any = await platformSettings().catch(() => null);
  if (!ps?.premblyCredsEnc) return { ok: false, reason: 'Identity verification is not configured yet. Please contact support.' };

  let apiKey = '';
  try { apiKey = JSON.parse(decrypt(ps.premblyCredsEnc))?.apiKey || ''; } catch { /* below */ }
  if (!apiKey) return { ok: false, reason: 'Identity verification is not configured yet. Please contact support.' };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: nin }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'TimeoutError' ? 'The identity service did not respond. Please try again shortly.' : 'Could not reach the identity service.' };
  }

  const body: any = await res.json().catch(() => null);
  if (!res.ok || body?.status !== true) {
    // Their message is written for a developer; a client filling in a form needs
    // to know whether to check the number or to wait.
    const msg = String(body?.message || body?.detail || '');
    const notFound = /not found|invalid|no record/i.test(msg);
    return { ok: false, reason: notFound ? "That NIN wasn't found. Check the number and try again." : 'Identity verification is unavailable right now. Please try again shortly.' };
  }

  const d = body.data || body.nin_data || {};
  const parts = [d.firstname, d.middlename, d.surname].filter(Boolean).map(String);
  const fullName = parts.join(' ');

  return {
    ok: true,
    reference: body.verification?.reference || body.reference_id || null,
    name: fullName,
    matched: namesMatch(claimedName, parts)
  };
}
