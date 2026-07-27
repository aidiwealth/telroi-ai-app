// control-app/src/queue.ts
// Holding callers when every agent is busy.
//
// Ring-all means whoever is free takes the call. When nobody is, the caller used
// to be told no one was available and dropped — which is a poor answer for a
// business whose agents are simply mid-conversation. They wait here instead,
// hearing music and their position, until an agent frees up or they give up.
//
// State is in memory: a queue only matters while calls are live, and a restart
// drops the channels anyway.
import type * as Ari from 'ari-client';

export interface QueuedCaller {
  channel: Ari.Channel;
  tenantId: string;
  joinedAt: number;
  /** Resolves when this caller is bridged, abandons, or times out. */
  done: () => void;
}

const queues = new Map<string, QueuedCaller[]>();

export function queueLength(tenantId: string): number {
  return (queues.get(tenantId) || []).length;
}

export function positionOf(tenantId: string, channelId: string): number {
  const q = queues.get(tenantId) || [];
  const i = q.findIndex((c) => c.channel.id === channelId);
  return i < 0 ? 0 : i + 1;
}

export function enqueue(caller: QueuedCaller): number {
  const q = queues.get(caller.tenantId) || [];
  q.push(caller);
  queues.set(caller.tenantId, q);
  return q.length;
}

export function dequeue(tenantId: string, channelId: string): void {
  const q = queues.get(tenantId);
  if (!q) return;
  const i = q.findIndex((c) => c.channel.id === channelId);
  if (i >= 0) q.splice(i, 1);
  if (!q.length) queues.delete(tenantId);
}

/** The caller who has waited longest, without removing them. */
export function peek(tenantId: string): QueuedCaller | null {
  const q = queues.get(tenantId);
  return q && q.length ? q[0] : null;
}

/**
 * Hold a caller until an agent frees up.
 *
 * Only the caller at the front is ever offered an agent — otherwise two people
 * would be bridged to the same person — and a caller who hangs up is removed at
 * once, so the front of the line never becomes a ghost blocking everyone behind.
 *
 * Returns the endpoints to ring once it's this caller's turn, or null when they
 * gave up, hung up, or waited too long.
 */
export async function holdUntilFree(opts: {
  client: any;
  channel: Ari.Channel;
  tenantId: string;
  freeEndpoints: () => Promise<string[]>;
  say: (text: string) => Promise<string | null>;
  log: (m: string) => void;
  maxWaitMs?: number;
}): Promise<string[] | null> {
  const { client, channel, tenantId, freeEndpoints, say, log } = opts;
  const maxWait = opts.maxWaitMs ?? 3 * 60 * 1000;
  const startedAt = Date.now();
  let alive = true;

  const onEnd = () => { alive = false; };
  channel.once('StasisEnd', onEnd);

  const position = enqueue({ channel, tenantId, joinedAt: startedAt, done: () => {} });
  log(`  [queue ${channel.id}] joined at position ${position} for tenant ${tenantId}`);

  // Tell them where they stand, and be honest when the wait looks long.
  const greeting = position === 1
    ? 'All of our agents are busy. Please hold and the next available agent will take your call.'
    : position > 5
      ? `There are ${position - 1} callers ahead of you. You are welcome to hold, or try again shortly.`
      : `All of our agents are busy. You are number ${position} in line. Please hold.`;
  try {
    const snd = await say(greeting);
    if (snd) await channel.play({ media: snd });
  } catch { /* a caller who can't hear the greeting can still wait */ }

  try { await channel.startMoh(); } catch { /* music is a nicety, not a requirement */ }

  let lastAnnounced = position;
  try {
    while (alive) {
      await new Promise((r) => setTimeout(r, 5000));
      if (!alive) break;

      if (Date.now() - startedAt > maxWait) {
        log(`  [queue ${channel.id}] waited ${Math.round((Date.now() - startedAt) / 1000)}s — giving up`);
        try { await channel.stopMoh(); } catch { /* */ }
        const snd = await say('We are sorry to keep you waiting. Please try again a little later. Goodbye.');
        try { if (snd) await channel.play({ media: snd }); } catch { /* */ }
        return null;
      }

      const now = positionOf(tenantId, channel.id);
      // Only say something when it actually changed — a repeating announcement
      // tells the caller nothing and costs a synthesis each time.
      if (now && now !== lastAnnounced) {
        lastAnnounced = now;
        if (now > 1) {
          const snd = await say(`You are now number ${now} in line.`);
          try { if (snd) await channel.play({ media: snd }); } catch { /* */ }
        }
      }

      if (now !== 1) continue;   // wait your turn
      const free = await freeEndpoints();
      if (!free.length) continue;

      log(`  [queue ${channel.id}] agent free after ${Math.round((Date.now() - startedAt) / 1000)}s`);
      try { await channel.stopMoh(); } catch { /* */ }
      return free;
    }
  } finally {
    dequeue(tenantId, channel.id);
    try { channel.removeListener('StasisEnd', onEnd); } catch { /* */ }
  }

  log(`  [queue ${channel.id}] caller left the queue`);
  return null;
}
