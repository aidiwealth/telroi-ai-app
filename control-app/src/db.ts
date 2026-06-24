// control-app/src/db.ts
// Standalone Postgres + Drizzle client for the control app.
//
// IMPORTANT: this is deliberately separate from the Nuxt app's server/db/index.ts,
// because that one uses useRuntimeConfig() (a Nitro-only function) which doesn't
// exist in a plain Node process. Here we read process.env.DATABASE_URL directly.
//
// We import the SAME schema as the main app (server/db/schema.ts is pure Drizzle,
// no Nuxt deps) so the table definitions never drift between the two.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from './config.ts';
import * as schema from './schema.ts';

// London (PBX) -> NYC (DB) is ~70-80ms RTT. We keep a small pool and rely on the
// cache layer (cache.ts) so per-call routing never waits on this connection.
const client = postgres(config.databaseUrl, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 15
});

export const db = drizzle(client, { schema });
export { schema };

// Graceful close (used on shutdown).
export async function closeDb() {
  try { await client.end({ timeout: 5 }); } catch { /* ignore */ }
}
