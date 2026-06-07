// server/utils/regions.ts
// Region detection from a phone number's country code, and the rule for which
// voice providers each region's numbers may attach to.
//
// Rule (per product spec):
//   NG (+234)            -> telroi (Digidite), sotel, ruach, or asterisk (global)
//   US/CA (+1), GB (+44) -> twilio, telnyx, or asterisk (global)
//   Asterisk is a global trunk and is therefore allowed in every region.

export function detectRegion(raw: string): string {
  const n = raw.replace(/[^\d+]/g, '');
  if (n.startsWith('+234') || n.startsWith('234') || (n.startsWith('0') && n.length === 11)) return 'NG';
  if (n.startsWith('+44') || n.startsWith('44')) return 'GB';
  if (n.startsWith('+1') || n.startsWith('1')) return 'US'; // +1 covers US & CA; admin can override to CA
  return 'NG'; // safe default; admin can override
}

export function providersForRegion(region: string): string[] {
  switch (region) {
    case 'NG': return ['telroi', 'sotel', 'ruach', 'asterisk'];
    case 'US':
    case 'CA':
    case 'GB': return ['twilio', 'telnyx', 'asterisk'];
    default: return ['telroi', 'sotel', 'ruach', 'asterisk'];
  }
}

export function regionLabel(region: string): string {
  return ({ NG: 'Nigeria', US: 'United States', CA: 'Canada', GB: 'United Kingdom' } as Record<string, string>)[region] || region;
}

// Validate that a chosen provider is allowed for a number's region.
export function providerAllowed(region: string, provider: string): boolean {
  return providersForRegion(region).includes(provider);
}
