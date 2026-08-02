// Supported agent languages (BCP-47). Codes chosen for Google Cloud STT/TTS coverage.
// Note: STT vs TTS voice availability varies by language — Nigerian English, Yoruba,
// French and the major foreign languages are best-supported; Igbo/Hausa transcribe
// but have fewer natural TTS voices (they degrade to a nearby voice).
export interface AgentLanguage { code: string; label: string; group: string; }

// Igbo and Zulu are deliberately absent. Google transcribes both but has no
// voice for either, so an agent set to one would hear the caller and then reply
// with silence — worse than not offering it. Add them back when a provider can
// actually speak them.
export const AGENT_LANGUAGES: AgentLanguage[] = [
  // Nigerian
  { code: 'en-NG', label: 'English (Nigeria)', group: 'Nigerian' },
  { code: 'yo-NG', label: 'Yoruba', group: 'Nigerian' },
  { code: 'ha-NG', label: 'Hausa', group: 'Nigerian' },
  // Other African
  { code: 'sw-KE', label: 'Swahili', group: 'African' },
  { code: 'am-ET', label: 'Amharic', group: 'African' },
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

// Typed as a tuple so z.enum can take it directly — the five endpoints that
// validate a language each restated this list, which is why removing Igbo and
// Zulu meant six edits and still missed the Copilot prompt.
export const AGENT_LANGUAGE_CODES = AGENT_LANGUAGES.map((l) => l.code) as [string, ...string[]];
export function isValidLanguage(code: string): boolean { return AGENT_LANGUAGE_CODES.includes(code); }
