// control-app/src/scheduler.ts
// Calls the web app's cron endpoints on a timer. Those endpoints were written for
// an external scheduler that was never wired up, so released numbers sat past
// their grace period instead of returning to the sellable pool. This box is
// already an always-on process, so it schedules them itself — no extra service to
// run or forget about.
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const CRON_SECRET = process.env.CRON_SECRET || '';
const EVERY_MS = Number(process.env.CRON_INTERVAL_MS || 3600000); // hourly

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[scheduler]', ...args);
}

async function runGraceJob() {
  if (!CRON_SECRET) return; // not configured — stay quiet rather than 401 hourly
  try {
    const res = await fetch(`${WEBAPP_URL}/api/cron/numbers-grace`, {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET }
    });
    if (!res.ok) { log(`numbers-grace: HTTP ${res.status}`); return; }
    const j = await res.json() as any;
    // Only worth a line when it actually did something.
    if (j?.returned) log(`numbers-grace: returned ${j.returned} number(s) to the pool (checked ${j.checked})`);
  } catch (e) {
    log('numbers-grace failed:', (e as Error).message);
  }
}

export function startScheduler() {
  if (!CRON_SECRET) {
    log('CRON_SECRET not set — grace-expiry job disabled (released numbers will not return to the pool)');
    return;
  }
  // Run shortly after boot so a restart catches anything missed while down.
  setTimeout(() => { void runGraceJob(); }, 30_000);
  setInterval(() => { void runGraceJob(); }, EVERY_MS);
  log(`grace-expiry job every ${Math.round(EVERY_MS / 60000)}min`);
}
