// server/utils/voice/otp-service.ts
// The Voice-OTP service core: generate a code, enforce the operator's rate
// limits + policy, place the OTP call via the selected vendor, and verify codes
// safely (hashed, attempt-capped, expiry-bound). OTP-ONLY — this never places a
// general call. All policy bounds come from platformSettings so the operator
// (not the client) ultimately controls length/ttl/frequency.
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import { sha256 } from '../crypto';
import { placeOtpCall } from './vendors';

export interface OtpPolicy {
  codeLength: number; ttlSeconds: number; maxAttempts: number;
  callTimeoutSec: number; repeatCount: number;
  rateMaxPerHour: number; rateMaxPerDay: number; rateCooldownSeconds: number;
}

export async function otpPolicy(): Promise<OtpPolicy> {
  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  return {
    codeLength: s?.otpCodeLength ?? 6,
    ttlSeconds: s?.otpTtlSeconds ?? 300,
    maxAttempts: s?.otpMaxAttempts ?? 3,
    callTimeoutSec: s?.otpCallTimeoutSeconds ?? 45,
    repeatCount: s?.otpRepeatCount ?? 2,
    rateMaxPerHour: s?.otpRateMaxPerHour ?? 5,
    rateMaxPerDay: s?.otpRateMaxPerDay ?? 20,
    rateCooldownSeconds: s?.otpRateCooldownSeconds ?? 60
  };
}

function genCode(len: number): string {
  // Cryptographically-random numeric code, no leading-zero bias avoidance needed
  // (leading zeros are fine for OTP — they're read digit by digit).
  let out = '';
  const { randomInt } = require('node:crypto');
  for (let i = 0; i < len; i++) out += String(randomInt(0, 10));
  return out;
}

export interface SendResult {
  ok: boolean; id?: string; status?: string; expiresAt?: string;
  error?: string; retryAfterSeconds?: number;
}

// Rate-limit a destination number against the operator policy.
async function checkRate(tenantId: string, toNumber: string, p: OtpPolicy): Promise<{ ok: boolean; retryAfter?: number; reason?: string }> {
  const db = useDb();
  const now = Date.now();
  const since = (secs: number) => new Date(now - secs * 1000);

  // cooldown: last send must be older than cooldown
  const [last] = await db.select({ createdAt: schema.voiceOtps.createdAt }).from(schema.voiceOtps)
    .where(and(eq(schema.voiceOtps.tenantId, tenantId), eq(schema.voiceOtps.toNumber, toNumber)))
    .orderBy(sql`${schema.voiceOtps.createdAt} DESC`).limit(1);
  if (last) {
    const sinceLast = (now - new Date(last.createdAt).getTime()) / 1000;
    if (sinceLast < p.rateCooldownSeconds) return { ok: false, retryAfter: Math.ceil(p.rateCooldownSeconds - sinceLast), reason: 'cooldown' };
  }
  // per-hour
  const [{ c: hourCount }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.voiceOtps)
    .where(and(eq(schema.voiceOtps.tenantId, tenantId), eq(schema.voiceOtps.toNumber, toNumber), gte(schema.voiceOtps.createdAt, since(3600))));
  if (hourCount >= p.rateMaxPerHour) return { ok: false, retryAfter: 3600, reason: 'hourly_limit' };
  // per-day
  const [{ c: dayCount }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.voiceOtps)
    .where(and(eq(schema.voiceOtps.tenantId, tenantId), eq(schema.voiceOtps.toNumber, toNumber), gte(schema.voiceOtps.createdAt, since(86400))));
  if (dayCount >= p.rateMaxPerDay) return { ok: false, retryAfter: 86400, reason: 'daily_limit' };
  return { ok: true };
}

// Send a voice OTP: generate, rate-check, place the call, persist (hashed).
export async function sendVoiceOtp(tenantId: string, toNumber: string, opts: { codeLength?: number; language?: string } = {}): Promise<SendResult> {
  const p = await otpPolicy();
  const db = useDb();

  // A client may request a SHORTER-or-equal nothing; length is clamped to the
  // operator policy bounds (never longer than allowed, min 4).
  const len = Math.max(4, Math.min(opts.codeLength || p.codeLength, p.codeLength));

  const rate = await checkRate(tenantId, toNumber, p);
  if (!rate.ok) return { ok: false, error: `rate_limited:${rate.reason}`, retryAfterSeconds: rate.retryAfter };

  const code = genCode(len);
  const expiresAt = new Date(Date.now() + p.ttlSeconds * 1000);
  const [row] = await db.insert(schema.voiceOtps).values({
    tenantId, toNumber, codeHash: sha256(code), codeLength: len,
    status: 'calling', maxAttempts: p.maxAttempts, expiresAt
  }).returning({ id: schema.voiceOtps.id });

  const placed = await placeOtpCall({ toNumber, code, language: opts.language, repeatCount: p.repeatCount, callTimeoutSec: p.callTimeoutSec });
  if (!placed.ok) {
    await db.update(schema.voiceOtps).set({ status: 'failed', reason: placed.reason }).where(eq(schema.voiceOtps.id, row.id));
    return { ok: false, id: row.id, status: 'failed', error: placed.reason };
  }
  await db.update(schema.voiceOtps).set({ status: 'delivered', provider: placed.providerRef ? undefined : undefined, providerRef: placed.providerRef }).where(eq(schema.voiceOtps.id, row.id));
  return { ok: true, id: row.id, status: 'delivered', expiresAt: expiresAt.toISOString() };
}

export interface VerifyResult { ok: boolean; status: string; error?: string; attemptsLeft?: number; }

// Verify a submitted code against the most recent unconsumed OTP for this number.
export async function verifyVoiceOtp(tenantId: string, idOrNumber: { id?: string; toNumber?: string }, code: string): Promise<VerifyResult> {
  const db = useDb();
  const filters = [eq(schema.voiceOtps.tenantId, tenantId)];
  if (idOrNumber.id) filters.push(eq(schema.voiceOtps.id, idOrNumber.id));
  else if (idOrNumber.toNumber) filters.push(eq(schema.voiceOtps.toNumber, idOrNumber.toNumber));
  else return { ok: false, status: 'error', error: 'id or toNumber required' };

  const [otp] = await db.select().from(schema.voiceOtps)
    .where(and(...filters))
    .orderBy(sql`${schema.voiceOtps.createdAt} DESC`).limit(1);
  if (!otp) return { ok: false, status: 'not_found', error: 'No OTP found' };
  if (otp.status === 'verified') return { ok: false, status: 'already_verified', error: 'Code already used' };
  if (new Date(otp.expiresAt).getTime() < Date.now()) {
    await db.update(schema.voiceOtps).set({ status: 'expired' }).where(eq(schema.voiceOtps.id, otp.id));
    return { ok: false, status: 'expired', error: 'Code expired' };
  }
  if (otp.attempts >= otp.maxAttempts) return { ok: false, status: 'locked', error: 'Too many attempts' };

  const match = sha256(code) === otp.codeHash;
  if (!match) {
    const attempts = otp.attempts + 1;
    const locked = attempts >= otp.maxAttempts;
    await db.update(schema.voiceOtps).set({ attempts, status: locked ? 'failed' : otp.status }).where(eq(schema.voiceOtps.id, otp.id));
    return { ok: false, status: locked ? 'locked' : 'mismatch', error: locked ? 'Too many attempts' : 'Incorrect code', attemptsLeft: Math.max(0, otp.maxAttempts - attempts) };
  }
  await db.update(schema.voiceOtps).set({ status: 'verified', verifiedAt: new Date() }).where(eq(schema.voiceOtps.id, otp.id));
  return { ok: true, status: 'verified' };
}
