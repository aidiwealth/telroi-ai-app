// server/utils/channel-limits.ts
// Channel capacity + simultaneous-call enforcement.
//
// A tenant's capacity = SUM(channels) across their ACTIVE number subscriptions.
// That's the number of concurrent calls they've paid for monthly. Before
// connecting a new call we count their in-flight calls and reject if at/over
// capacity ("all lines busy"), so the monthly channel charge is a real limit.
//
// "In-flight" = live call sessions in calling/connected state PLUS recent
// callEvents still ringing/in-progress (covers dialer + widget + carrier calls).
import { and, eq, inArray, gte, sql } from 'drizzle-orm';
import { useDb, schema } from '../db';

export interface ChannelUsage { capacity: number; inUse: number; available: number; }

// Total concurrent-call capacity the tenant has paid for.
export async function channelCapacity(tenantId: string): Promise<number> {
  const db = useDb();
  const rows = await db.select({ channels: schema.numberSubscriptions.channels })
    .from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.status, 'active')));
  return rows.reduce((sum, r) => sum + (r.channels || 0), 0);
}

// How many calls the tenant currently has in flight.
export async function liveCallCount(tenantId: string): Promise<number> {
  const db = useDb();
  // 1. Live Call widget sessions actively calling/connected.
  const sessions = await db.select({ id: schema.liveCallSessions.id })
    .from(schema.liveCallSessions)
    .where(and(
      eq(schema.liveCallSessions.tenantId, tenantId),
      inArray(schema.liveCallSessions.status, ['calling', 'connected'])
    ));
  // 2. Dialer / carrier call events still in progress. Guard against stale rows
  //    (no end + started within the last 2h) so a crashed call doesn't wedge a
  //    channel forever.
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const events = await db.select({ id: schema.callEvents.id })
    .from(schema.callEvents)
    .where(and(
      eq(schema.callEvents.tenantId, tenantId),
      inArray(schema.callEvents.status, ['ringing', 'in-progress', 'initiated', 'answered']),
      gte(schema.callEvents.startedAt, since)
    ));
  return sessions.length + events.length;
}

export async function channelUsage(tenantId: string): Promise<ChannelUsage> {
  const [capacity, inUse] = await Promise.all([channelCapacity(tenantId), liveCallCount(tenantId)]);
  return { capacity, inUse, available: Math.max(0, capacity - inUse) };
}

// Throwable guard used at every call-initiation chokepoint. Returns the usage
// snapshot when there's room; throws a 429 "all lines busy" when at capacity.
// Tenants with zero subscriptions are treated as zero capacity (can't place
// calls until they buy a number) EXCEPT internal workspaces, which are exempt.
export async function assertChannelAvailable(tenantId: string, opts?: { isInternal?: boolean }): Promise<ChannelUsage> {
  const usage = await channelUsage(tenantId);
  if (opts?.isInternal) return usage; // support/internal workspaces aren't capacity-limited
  if (usage.capacity === 0) {
    const err: any = new Error('No active channels. Buy a number to place or receive calls.');
    err.statusCode = 402; err.data = { error: { code: 'no_channels', message: 'No active channels. Buy a number to place or receive calls.' } };
    throw err;
  }
  if (usage.inUse >= usage.capacity) {
    const err: any = new Error('All lines are busy. Add channels to handle more simultaneous calls.');
    err.statusCode = 429; err.data = { error: { code: 'channels_busy', message: 'All lines are busy. Add channels to handle more simultaneous calls.', capacity: usage.capacity, inUse: usage.inUse } };
    throw err;
  }
  return usage;
}
