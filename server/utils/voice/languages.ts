// Supported agent languages (BCP-47). Codes chosen for Google Cloud STT/TTS coverage.
// Note: STT vs TTS voice availability varies by language — Nigerian English, Yoruba,
// French and the major foreign languages are best-supported; Igbo/Hausa transcribe
// but have fewer natural TTS voices (they degrade to a nearby voice).
export interface AgentLanguage { code: string; label: string; group: string; }

export const AGENT_LANGUAGES: AgentLanguage[] = [
  // Nigerian
  { code: 'en-NG', label: 'English (Nigeria)', group: 'Nigerian' },
  { code: 'yo-NG', label: 'Yoruba', group: 'Nigerian' },
  { code: 'ig-NG', label: 'Igbo', group: 'Nigerian' },
  { code: 'ha-NG', label: 'Hausa', group: 'Nigerian' },
  // Other African
  { code: 'sw-KE', label: 'Swahili', group: 'African' },
  { code: 'am-ET', label: 'Amharic', group: 'African' },
  { code: 'zu-ZA', label: 'Zulu', group: 'African' },
  { code: 'af-ZA', label: 'Afrikaans', group: 'African' },
  // Common foreign
  { code: 'en-US', label: 'English (US)', group: 'International' },
  { code: 'en-GB', label: 'English (UK)', group: 'International' },
  { code: 'fr-FR', label: 'French', group: 'International' },
  { code: 'ar-XA', label: 'Arabic', group: 'International' },
  { code: 'pt-PT', label: 'Portuguese', group: 'International' },
  { code: 'es-ES', label: 'Spanish', group: 'International' },
  { code: 'de-DE', label: 'German', group: 'International' },
  { code: 'hi-IN', label: 'Hindi', group: 'International' },
  { code: 'zh', label: 'Chinese (Mandarin)', group: 'International' }
];

export const AGENT_LANGUAGE_CODES = AGENT_LANGUAGES.map((l) => l.code);
export function isValidLanguage(code: string): boolean { return AGENT_LANGUAGE_CODES.includes(code); }
