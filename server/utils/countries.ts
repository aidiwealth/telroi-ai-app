// server/utils/countries.ts
// Maps a client's country (as captured at signup, a display name like "Nigeria")
// to the settings that should follow from it: wallet currency, billing region,
// and the default funding method. This is the single source of truth so country
// actually drives per-client behavior instead of defaulting to USD/card.

export interface CountryProfile {
  currency: 'NGN' | 'USD';
  region: string;           // NG | US | CA | GB | ... (drives voice/SIP vendors)
  funding: 'bank_transfer' | 'card'; // NGN -> Naira virtual account; else card
  dialCode: string;
}

const PROFILES: Record<string, CountryProfile> = {
  'Nigeria':                { currency: 'NGN', region: 'NG', funding: 'bank_transfer', dialCode: '+234' },
  'Ghana':                  { currency: 'USD', region: 'GH', funding: 'card', dialCode: '+233' },
  'Kenya':                  { currency: 'USD', region: 'KE', funding: 'card', dialCode: '+254' },
  'South Africa':           { currency: 'USD', region: 'ZA', funding: 'card', dialCode: '+27' },
  'United States':          { currency: 'USD', region: 'US', funding: 'card', dialCode: '+1' },
  'Canada':                 { currency: 'USD', region: 'CA', funding: 'card', dialCode: '+1' },
  'United Kingdom':         { currency: 'USD', region: 'GB', funding: 'card', dialCode: '+44' },
  'Germany':                { currency: 'USD', region: 'DE', funding: 'card', dialCode: '+49' },
  'France':                 { currency: 'USD', region: 'FR', funding: 'card', dialCode: '+33' },
  'United Arab Emirates':   { currency: 'USD', region: 'AE', funding: 'card', dialCode: '+971' },
  'India':                  { currency: 'USD', region: 'IN', funding: 'card', dialCode: '+91' }
};

const DEFAULT: CountryProfile = { currency: 'USD', region: 'US', funding: 'card', dialCode: '+1' };

export function countryProfile(country?: string | null): CountryProfile {
  if (!country) return DEFAULT;
  return PROFILES[country] || DEFAULT;
}

export function currencyForCountry(country?: string | null): 'NGN' | 'USD' {
  return countryProfile(country).currency;
}

export function isNigeria(country?: string | null): boolean {
  return countryProfile(country).region === 'NG';
}

export const SUPPORTED_COUNTRIES = Object.keys(PROFILES).concat(['Other']);
