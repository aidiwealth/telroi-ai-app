// server/plugins/00.security-preflight.ts
// Fails fast at boot if critical secrets are missing or left at insecure defaults
// in production. This prevents the single most dangerous misconfiguration: running
// live with a publicly-known fallback JWT secret (which would let anyone forge
// admin sessions) or without an encryption key (which would expose stored creds).
const INSECURE_JWT_DEFAULT = 'dev-insecure-secret-change-me';

export default defineNitroPlugin(() => {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) return; // dev/test may use fallbacks for convenience

  const problems: string[] = [];
  const jwt = process.env.JWT_SECRET || '';
  if (!jwt || jwt === INSECURE_JWT_DEFAULT) {
    problems.push('JWT_SECRET is missing or set to the insecure default — set a long random value.');
  } else if (jwt.length < 32) {
    problems.push('JWT_SECRET is too short — use at least 32 random characters.');
  }

  const enc = process.env.ENCRYPTION_KEY || '';
  if (!enc) {
    problems.push('ENCRYPTION_KEY is missing — set a 32-byte base64 value.');
  } else {
    try {
      if (Buffer.from(enc, 'base64').length !== 32) {
        problems.push('ENCRYPTION_KEY must decode to exactly 32 bytes.');
      }
    } catch {
      problems.push('ENCRYPTION_KEY is not valid base64.');
    }
  }

  if (problems.length) {
    // Refuse to boot: a misconfigured production server is worse than a stopped one.
    const msg = '[SECURITY] Refusing to start in production:\n  - ' + problems.join('\n  - ');
    console.error(msg);
    throw new Error(msg);
  }
});
