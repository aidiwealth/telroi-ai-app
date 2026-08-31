/**
 * What a number may be used for.
 *
 * One definition, because there were two: this list lived in pages/numbers.vue
 * and the sensitive keys were repeated as a bare array in the purchase
 * endpoint. Adding a seventh category to one and not the other would have let a
 * client buy a sensitive number without the indemnity — silently, since neither
 * side would have known it was wrong.
 *
 * The wording matters and is not incidental: somebody ticking "Authentication"
 * here should recognise the same word when they read what they are signing.
 */
export interface UseCategory {
  key: string;
  label: string;
  hint: string;
  /** Needs the Number Use Indemnity accepted before the number is sold. */
  sensitive: boolean;
}

export const USE_CATEGORIES: UseCategory[] = [
  { key: 'general', label: 'General business',
    hint: 'Ordinary calls to and from your business.', sensitive: false },
  { key: 'authentication', label: 'Authentication',
    hint: 'One-time passcodes, verification, transaction alerts.', sensitive: true },
  { key: 'financial', label: 'Financial services',
    hint: 'Banking, payments, lending, collections, insurance.', sensitive: true },
  { key: 'health', label: 'Health & sensitive data',
    hint: 'Medical, insurance, or special-category data.', sensitive: true },
  { key: 'emergency', label: 'Emergency & welfare',
    hint: 'Crisis, safety, welfare and helpline services.', sensitive: true },
  { key: 'government', label: 'Government & public sector',
    hint: 'Public authority, civic and electoral.', sensitive: true },
  { key: 'outbound', label: 'Scaled outbound',
    hint: 'Campaigns at volume, or automated and AI dialling.', sensitive: true }
];

export const SENSITIVE_KEYS = USE_CATEGORIES.filter((c) => c.sensitive).map((c) => c.key);
