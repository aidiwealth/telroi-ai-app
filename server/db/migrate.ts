import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
const baseline = process.argv.includes('--baseline-existing');
if (process.argv.slice(2).some(arg => arg !== '--baseline-existing')) {
  throw new Error('Usage: npm run db:migrate [-- --baseline-existing]');
}
const migrationsFolder = fileURLToPath(new URL('./migrations/', import.meta.url));
const sql = postgres(url, { max: 1, connect_timeout: 10 });

// Explicit adoption of installations created before migration history existed.
// Only 0000 is baselined; every subsequent migration still runs normally.
async function baselineExisting() {
  const snapshot = JSON.parse(readFileSync(`${migrationsFolder}/meta/0000_snapshot.json`, 'utf8')) as {
    tables: Record<string, { name: string; columns: Record<string, { name: string; type: string; notNull: boolean }> }>;
    enums: Record<string, { name: string; values: string[] }>;
  };
  const additions = new Set(['token_enc', 'provider_customer_id', 'billing_email',
    'provider_signature', 'reusable', 'updated_at']);
  const columns = await sql`
    SELECT c.relname AS table_name, a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  `;
  const actual = new Map(columns.map(c => [`${c.table_name}.${c.column_name}`, c]));
  const mismatches: string[] = [];
  for (const table of Object.values(snapshot.tables)) {
    for (const column of Object.values(table.columns)) {
      if (table.name === 'payment_methods' && additions.has(column.name)) continue;
      const key = `${table.name}.${column.name}`;
      const found = actual.get(key);
      if (!found || found.type !== column.type || (column.notNull && !found.not_null)) {
        mismatches.push(key);
      }
    }
  }
  const enums = await sql`
    SELECT t.typname AS name, e.enumlabel AS value FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
  `;
  for (const type of Object.values(snapshot.enums)) {
    if (type.values.some(value => !enums.some(e => e.name === type.name && e.value === value))) {
      mismatches.push(`enum ${type.name}`);
    }
  }
  if (mismatches.length) {
    throw new Error(`Cannot baseline: schema differs from the legacy baseline: ${mismatches.join(', ')}. Review schema drift before proceeding.`);
  }
  // Reject partially applied feature schemas, rather than guessing their history.
  if (actual.has('payment_methods.source_payment_reference') || actual.has('auto_topup_settings.tenant_id') ||
      actual.has('auto_topup_attempts.id') || actual.has('payments.save_payment_method_requested')) {
    throw new Error('Feature tables/columns exist without migration history. Reconcile their history explicitly before migrating.');
  }
  const first = readMigrationFiles({ migrationsFolder })[0];
  await sql.begin(async tx => {
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${first.hash}, ${first.folderMillis})`;
  });
  console.log('Existing schema baselined at 0000; applying all subsequent migrations.');
}

try {
  await sql`SET lock_timeout = '5s'`;
  await sql`SET statement_timeout = '60s'`;
  // Session-level lock covers history adoption and the normal Drizzle transaction.
  const [lock] = await sql`SELECT pg_try_advisory_lock(734921, 1) AS acquired`;
  if (!lock.acquired) throw new Error('Another migration is running. Retry after it finishes.');
  const [history] = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS name`;
  const applied = history.name ? await sql`SELECT id FROM drizzle.__drizzle_migrations LIMIT 1` : [];
  if (baseline) {
    if (applied.length) throw new Error('Migration history already exists. Run npm run db:migrate without --baseline-existing.');
    await baselineExisting();
  } else if (!applied.length) {
    const [existing] = await sql`SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public') AS present`;
    if (existing.present) throw new Error('Existing database has no migration history. Back it up and review the baseline procedure in README.md before using --baseline-existing.');
  }
  await migrate(drizzle(sql), { migrationsFolder });
  console.log('✓ migrations applied');
} finally {
  // Closing the connection also releases the advisory lock, including on errors.
  await sql.end();
}
