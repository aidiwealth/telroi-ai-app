// server/plugins/status-monitor.ts
// Runs the predetermined component probes on a schedule and records ONE
// status_checks row per component per run. The public status page derives live
// status + 90-day uptime from these recorded checks — nothing is typed by admin.
//
// NOTE (single-instance): this uses an in-process interval, which is correct for
// a single app instance (e.g. one DigitalOcean App Platform instance). If you
// scale to multiple instances, each would probe independently and double-write;
// at that point move this to an external cron hitting an authenticated
// /internal/run-status-checks route, or add a DB advisory lock. Flagged on purpose.
import { STATUS_COMPONENTS } from '../utils/status-registry';
import { useDb, schema } from '../db';

const INTERVAL_MS = 60_000; // probe every 60s

async function runChecksOnce() {
  const db = useDb();
  for (const def of STATUS_COMPONENTS) {
    try {
      const r = await def.probe();
      await db.insert(schema.statusChecks).values({
        componentKey: def.key,
        ok: r.ok,
        state: r.state,
        latencyMs: r.latencyMs ?? null,
        detail: r.detail ?? null
      });
    } catch (e: any) {
      // a failing probe is itself a signal — record it as a major_outage check
      try {
        await db.insert(schema.statusChecks).values({
          componentKey: def.key, ok: false, state: 'major_outage', detail: e?.message?.slice(0, 120) ?? 'probe error'
        });
      } catch { /* swallow — never crash the app over a status check */ }
    }
  }
}

export default defineNitroPlugin(() => {
  // Don't run during build/prerender.
  if (process.env.NITRO_PRERENDER) return;
  // Kick off shortly after boot, then on an interval.
  setTimeout(() => { runChecksOnce().catch(() => {}); }, 8_000);
  const timer = setInterval(() => { runChecksOnce().catch(() => {}); }, INTERVAL_MS);
  // Allow the process to exit cleanly in dev.
  if (typeof timer.unref === 'function') timer.unref();
});
