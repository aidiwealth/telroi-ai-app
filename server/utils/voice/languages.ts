// Re-exported from utils/languages so the client and server share one list —
// the codes are needed by Zod schemas here and by the language picker there, and
// two copies drift.
export { AGENT_LANGUAGES, AGENT_LANGUAGE_CODES, isValidLanguage, type AgentLanguage } from '../../../utils/languages';
