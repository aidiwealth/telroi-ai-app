// Single source of truth for the default SIP domain. The real value should come
// from the SIP_DOMAIN env var; this constant is only the fallback so the server
// token and the client dialer never drift to different hardcoded strings.
export const DEFAULT_SIP_DOMAIN = 'sip.telroi.ai';
