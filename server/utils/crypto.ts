// server/utils/crypto.ts
// AES-256-GCM encryption for secrets at rest (AI keys, carrier creds, Telroi key).
// Plus SHA-256 hashing for tokens/OTPs/API keys.
import {
  createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual
} from 'node:crypto';

function getKey(): Buffer {
  const b64 = useRuntimeConfig().encryptionKey;
  if (!b64) throw new Error('ENCRYPTION_KEY is not set (expect 32-byte base64)');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

// Format: base64(iv).base64(authTag).base64(ciphertext)
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomOtp(): string {
  // 6-digit, zero-padded
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

export function last4(s: string): string {
  return s.slice(-4);
}
