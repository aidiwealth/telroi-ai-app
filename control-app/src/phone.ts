// control-app/src/phone.ts
//
// A copy of the web app's. The two apps have separate schemas and separate
// utilities, and this function has no dependencies — duplicating it is cheaper
// than a shared package, so long as a change to one is made to both.
// One way to write a phone number, so the same person isn't three contacts.
//
// Ruach presents inbound Nigerian callers as 00 followed by the national number
// without its trunk zero — 007077592525 for what a Nigerian would dial as
// 07077592525. Stored raw, that number never matches the +2347077592525 we hold
// for the same person, so calling them back dialled something invalid and the
// CRM grew a second contact each time the format shifted.

/** Canonical E.164, or the input untouched if it can't be read confidently.
 *  Guessing wrongly is worse than leaving it alone: a mangled number can't be
 *  dialled and can't be matched back to whatever it came from. */
export function normalizePhone(input: string | null | undefined): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  // Already canonical.
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;

  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return raw;

  // 00 is the international prefix. What follows is a country code and number,
  // except from Ruach, where it's a Nigerian national number with the trunk zero
  // already stripped.
  if (digits.startsWith('00')) {
    const rest = digits.slice(2);
    if (rest.startsWith('234')) return `+${rest}`;
    // A Nigerian mobile is 10 digits after the country code and starts 7, 8 or 9.
    if (/^[789]\d{9}$/.test(rest)) return `+234${rest}`;
    if (rest.length >= 8) return `+${rest}`;
    return raw;
  }

  // Nigerian local: 0803..., eleven digits.
  if (/^0[789]\d{9}$/.test(digits)) return `+234${digits.slice(1)}`;

  // Country code without the plus.
  if (digits.startsWith('234') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;

  // Bare national number, no prefix at all.
  if (/^[789]\d{9}$/.test(digits)) return `+234${digits}`;

  return raw;
}

/** True when two numbers are the same line however each was written. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return !!na && na === nb;
}
