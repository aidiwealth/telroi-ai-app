// composables/useMoney.ts
// Formats integer minor units (cents/kobo) into parts for superscript-cents
// display, Mercury-style: $1,000.⁶⁹
export function useMoney() {
  function symbol(currency: string) { return currency === 'NGN' ? '₦' : '$'; }

  // Returns { sym, whole, cents } for templating <span>{{sym}}{{whole}}<sup>{{cents}}</sup>
  function parts(minor: number, currency = 'USD') {
    const neg = minor < 0;
    const abs = Math.abs(minor || 0);
    const whole = Math.floor(abs / 100).toLocaleString();
    const cents = String(abs % 100).padStart(2, '0');
    return { sym: symbol(currency), whole, cents, neg };
  }

  // Plain string fallback
  function format(minor: number, currency = 'USD') {
    const p = parts(minor, currency);
    return `${p.neg ? '−' : ''}${p.sym}${p.whole}.${p.cents}`;
  }

  return { symbol, parts, format };
}
