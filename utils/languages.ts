// The languages an AI agent can speak, in one place.
//
// This lived in server/utils and was restated in five endpoints and again in the
// connections component — so removing Igbo and Zulu took six edits and still left
// the Copilot prompt offering them. Here because utils/ is reachable from both
// the client and the server; the server copy re-exports it.
//
// Codes chosen for Google Cloud coverage. Availability differs between hearing a
// language and speaking it: Nigerian English, Yoruba, Hausa, French and the major
// foreign languages work end to end. Igbo and Zulu are deliberately absent —
// Google transcribes both but has no voice for either, so an agent set to one
// would hear the caller and reply with silence. Add them back when a provider can
// actually speak them.
export interface AgentLanguage { code: string; label: string; group: string; }

export const AGENT_LANGUAGES: AgentLanguage[] = [
  { code: 'en-NG', label: 'English (Nigeria)', group: 'Nigerian' },
  { code: 'yo-NG', label: 'Yoruba', group: 'Nigerian' },
  { code: 'ha-NG', label: 'Hausa', group: 'Nigerian' },
  { code: 'sw-KE', label: 'Swahili', group: 'African' },
  { code: 'am-ET', label: 'Amharic', group: 'African' },
  { code: 'af-ZA', label: 'Afrikaans', group: 'African' },
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

// Typed as a tuple so z.enum can take it directly.
export const AGENT_LANGUAGE_CODES = AGENT_LANGUAGES.map((l) => l.code) as [string, ...string[]];
export function isValidLanguage(code: string): boolean { return AGENT_LANGUAGE_CODES.includes(code); }
