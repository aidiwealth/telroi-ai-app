// server/db/run-billing.ts
// CLI runner for recurring monthly billing. Delegates to the shared engine in
// server/utils/billing.ts so the logic lives in exactly one place (the cron
// endpoint /api/cron/billing uses the same engine).
//
// Run daily via cron / a scheduled job:
//   set -a && source .env && set +a && npm run billing:run
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { lte, isNotNull, and } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';
import { runMonthlyBilling } from '../utils/billing';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
const sql = postgres(url);
const db = drizzle(sql, { schema });

async function main() {
  const now = new Date();
  const r = await runMonthlyBilling(db as any, { now });
  console.log(`${r.due} due — ${r.charged} charged, ${r.suspended} suspended, ${r.skipped} skipped`);
  for (const d of r.details) {
    if (d.outcome === 'charged') console.log(`  charged ${d.telnum}: ${d.amountMinor} ${d.currency} minor`);
    else if (d.outcome === 'suspended') console.log(`  suspended ${d.telnum} (insufficient funds)`);
  }

  // Platform-wide maintenance the CLI runner also performs:
  const lapsed = await db.update(schema.tenants)
    .set({ trialPlan: null, trialEndsAt: null, plan: 'startup' })
    .where(and(isNotNull(schema.tenants.trialEndsAt), lte(schema.tenants.trialEndsAt, now)))
    .returning({ id: schema.tenants.id });
  if (lapsed.length) console.log(`  reverted ${lapsed.length} lapsed trial(s) to startup`);

  const prunedLogs = await db.delete(schema.logs).where(lte(schema.logs.expiresAt, now)).returning({ id: schema.logs.id });
  if (prunedLogs.length) console.log(`  pruned ${prunedLogs.length} expired log row(s)`);

  console.log('✓ billing run complete');
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
