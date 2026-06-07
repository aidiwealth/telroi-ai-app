// server/db/backfill-virtual-accounts.ts
// One-off backfill: give every existing workspace that lacks a virtual account
// a DEMO Moniepoint-style reserved account so the wallet's bank-transfer UI has
// something to show before real Monnify provisioning runs.
//
// IMPORTANT: these are DEMO accounts (status 'demo'), not real Monnify accounts.
// They let you see and test the UI. Real accounts are created via the live
// Monnify API through /api/wallet/account once MONNIFY_* keys are set; that path
// will replace a demo row when a workspace first reserves a real account.
//
// Run with:  set -a && source .env && set +a && npx tsx server/db/backfill-virtual-accounts.ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, notInArray } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const sql = postgres(url);
const db = drizzle(sql, { schema });

// Deterministic 10-digit Moniepoint-style demo number from a seed string.
function demoAccountNumber(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // Moniepoint personal numbers commonly start 6/8/9; use a stable prefix.
  const body = String(h).padStart(10, '0').slice(0, 9);
  return `8${body}`;
}

async function main() {
  const tenants = await db.select().from(schema.tenants);
  const existing = await db.select().from(schema.virtualAccounts);
  const haveByTenant = new Set(existing.map((v) => v.tenantId));

  let created = 0;
  for (const t of tenants) {
    if (haveByTenant.has(t.id)) continue;
    const acctNum = demoAccountNumber(t.id);
    await db.insert(schema.virtualAccounts).values({
      tenantId: t.id,
      provider: 'monnify',
      accountReference: `demo-${t.slug}`,
      accountName: `Telroi - ${t.name}`,
      accountNumber: acctNum,
      bankName: 'Moniepoint MFB',
      bankCode: '50515',
      accounts: [{ bankName: 'Moniepoint MFB', bankCode: '50515', accountNumber: acctNum, accountName: `Telroi - ${t.name}` }],
      status: 'demo'
    });
    created++;
    console.log(`  + demo account ${acctNum} for ${t.slug}`);
  }

  console.log(`✓ backfill complete — ${created} demo virtual account(s) created, ${tenants.length - created} already had one`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
