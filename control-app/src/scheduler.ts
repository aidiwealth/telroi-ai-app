// control-app/src/scheduler.ts
// Calls the web app's cron endpoints on a timer. Those endpoints were written for
// an external scheduler that was never wired up, so released numbers sat past
// their grace period instead of returning to the sellable pool. This box is
// already an always-on process, so it schedules them itself — no extra service to
// run or forget about.
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const CRON_SECRET = process.env.CRON_SECRET || '';
function intervalMs(raw: string | undefined, fallback: number, minimum: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}
const GRACE_EVERY_MS = intervalMs(process.env.CRON_INTERVAL_MS, 3_600_000, 60_000); // hourly
const AUTO_TOPUP_EVERY_MS = intervalMs(process.env.AUTO_TOPUP_CRON_INTERVAL_MS, 60_000, 10_000); // every minute

let autoTopupRunning = false;

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

async function runAutoTopupJob() {
  if (!CRON_SECRET || autoTopupRunning) return;
  autoTopupRunning = true;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/cron/auto-topup`, {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
      // Do not let one stalled request overlap every later one-minute tick.
      signal: AbortSignal.timeout(55_000)
    });
    if (!res.ok) { log(`auto-topup: HTTP ${res.status}`); return; }
    const body = await res.json() as any;
    const result = body?.execution || {};
    const reportable = ['dispatched', 'recovered', 'succeeded', 'failed',
      'uncertain', 'needs_review', 'errors']
      .some(key => Number(result[key] || 0) > 0);
    // Stay quiet when there is no work; this runs every minute in production.
    if (reportable) log('auto-topup:', result);
  } catch (e) {
    log('auto-topup failed:', (e as Error).message);
  } finally {
    autoTopupRunning = false;
  }
}

export function startScheduler() {
  if (!CRON_SECRET) {
    log('CRON_SECRET not set — scheduled jobs disabled');
    return;
  }
  // Run shortly after boot so a restart catches anything missed while down.
  setTimeout(() => {
    void runGraceJob();
    void runAutoTopupJob();
  }, 30_000);
  setInterval(() => { void runGraceJob(); }, GRACE_EVERY_MS);
  setInterval(() => { void runAutoTopupJob(); }, AUTO_TOPUP_EVERY_MS);
  log(`grace-expiry job every ${Math.round(GRACE_EVERY_MS / 60000)}min`);
  log(`auto-topup job every ${Math.round(AUTO_TOPUP_EVERY_MS / 1000)}s`);
}
