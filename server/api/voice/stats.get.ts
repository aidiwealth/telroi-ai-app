// GET /api/voice/stats?period=today -> accurate call counts for the dashboard.
// Counts over the database directly (not a capped history fetch), and includes
// voice OTP calls, which live in voice_otps rather than call_events — an
// OTP-heavy client was seeing 0 (or a 200 cap) when they'd sent thousands.
import { and, eq, gte, sql } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const period = String(getQuery(event).period || 'today');
  const since = period === 'month' ? new Date(Date.now() - 30 * 864e5)
    : period === 'week' ? new Date(Date.now() - 7 * 864e5)
    : new Date(new Date().setHours(0, 0, 0, 0)); // today
  const db = useDb();

  // Regular calls from call_events, split by direction + missed + wait.
  const ce = await db.select({
    direction: schema.callEvents.direction,
    status: schema.callEvents.status,
    wait: schema.callEvents.wait,
    duration: schema.callEvents.duration
  }).from(schema.callEvents)
    .where(and(eq(schema.callEvents.tenantId, s.tenantId), gte(schema.callEvents.createdAt, since)));

  // OTP calls (outbound voice) from voice_otps.
  const [{ otp }] = await db.select({ otp: sql<number>`count(*)` })
    .from(schema.voiceOtps)
    .where(and(eq(schema.voiceOtps.tenantId, s.tenantId), gte(schema.voiceOtps.createdAt, since)));

  const inbound = ce.filter((c) => c.direction === 'in').length;
  const callOut = ce.filter((c) => c.direction === 'out').length;
  const missed = ce.filter((c) => c.status === 'missed').length;
  const answered = ce.filter((c) => (c.duration || 0) > 0);
  const avgWait = answered.length
    ? Math.round(answered.reduce((n, c) => n + (c.wait || 0), 0) / answered.length) : 0;
  const otpCount = Number(otp) || 0;

  return {
    total: inbound + callOut + otpCount,
    inbound,
    outbound: callOut + otpCount,  // OTP is outbound voice
    otp: otpCount,
    missed,
    avgWait
  };
});
