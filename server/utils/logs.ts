// server/utils/logs.ts
// Lightweight activity logging. Writes a compact row with a 60-day TTL. Logging
// must never break the request path, so all writes are best-effort (errors are
// swallowed). A prune job deletes expired rows to keep the table small.
import { lt } from 'drizzle-orm';
import { useDb, schema } from '../db';

const TTL_DAYS = 60;

export interface LogInput {
  tenantId?: string | null;
  kind: 'call' | 'system';
  action: string;
  summary?: string;
  level?: 'info' | 'warn' | 'error';
  ref?: string;
}

export async function logEvent(input: LogInput): Promise<void> {
  try {
    const db = useDb();
    const expiresAt = new Date(Date.now() + TTL_DAYS * 86400000);
    await db.insert(schema.logs).values({
      tenantId: input.tenantId ?? null,
      kind: input.kind,
      action: input.action,
      summary: input.summary?.slice(0, 240) ?? null,
      level: input.level ?? 'info',
      ref: input.ref ?? null,
      expiresAt
    });
  } catch (e) {
    // Never let logging failures bubble into the request.
    console.error('[logs] write failed', (e as any)?.message);
  }
}

// Delete expired log rows. Call from the billing/cron runner.
export async function pruneExpiredLogs(): Promise<number> {
  const db = useDb();
  const res = await db.delete(schema.logs).where(lt(schema.logs.expiresAt, new Date())).returning({ id: schema.logs.id });
  return res.length;
}
