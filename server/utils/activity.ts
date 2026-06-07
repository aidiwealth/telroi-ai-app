// server/utils/activity.ts
// Marks a tenant as "active" when they perform a real system action (top-up,
// number purchase, VAN create/activate, etc.). The inactivity follow-up cron
// uses lastActivityAt to decide whether to nudge. Best-effort: never throws.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function touchActivity(tenantId: string) {
  try {
    const db = useDb();
    await db.update(schema.tenants).set({ lastActivityAt: new Date() }).where(eq(schema.tenants.id, tenantId));
  } catch { /* non-critical */ }
}
