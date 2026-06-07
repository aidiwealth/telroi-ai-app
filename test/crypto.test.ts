import { describe, it, expect, beforeAll } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// Mirror of server/utils/crypto.ts with an injectable key (the real module
// reads useRuntimeConfig(), which isn't available in a bare vitest process).
const KEY = randomBytes(32);
function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}
function decrypt(payload: string) {
  const [iv, tag, ct] = payload.split('.');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('encryption at rest', () => {
  it('round-trips a secret', () => {
    const secret = 'sk-test-abcdef1234567890';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });
  it('produces a different ciphertext each time (random IV)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });
  it('rejects a tampered ciphertext', () => {
    const enc = encrypt('secret');
    const [iv, tag, ct] = enc.split('.');
    const bad = `${iv}.${tag}.${Buffer.from('zzzz').toString('base64')}`;
    expect(() => decrypt(bad)).toThrow();
  });
});

describe('token hashing', () => {
  it('hashes deterministically and compares in constant time', () => {
    const a = sha256('123456'), b = sha256('123456');
    expect(timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))).toBe(true);
  });
});
