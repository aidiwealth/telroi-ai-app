// control-app/src/log-buffer.ts
// In-memory ring buffer of recent log lines, for the admin live-log viewer.
// No DB, no persistence — just the last N lines held in memory (near-zero cost).
// We hook console.log/console.error so EVERY log line (module logs, [ai-call],
// bridge, errors) is captured with a single interception point.

export interface LogLine { seq: number; ts: number; level: 'info' | 'error'; text: string; }

const MAX = 800;                 // ring buffer capacity
const buffer: LogLine[] = [];
let seq = 0;

function push(level: 'info' | 'error', args: unknown[]) {
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  buffer.push({ seq: ++seq, ts: Date.now(), level, text });
  if (buffer.length > MAX) buffer.shift();
}

let installed = false;
export function installLogCapture() {
  if (installed) return;
  installed = true;
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  console.log = (...args: unknown[]) => { try { push('info', args); } catch { /* never break logging */ } origLog(...args); };
  console.error = (...args: unknown[]) => { try { push('error', args); } catch { /* */ } origErr(...args); };
}

// Return lines after a given seq (for incremental polling). If afterSeq is 0 or
// missing, returns the whole buffer (initial load).
export function getLines(afterSeq = 0, limit = MAX): LogLine[] {
  const out = afterSeq > 0 ? buffer.filter((l) => l.seq > afterSeq) : buffer.slice();
  return out.slice(-limit);
}

export function latestSeq(): number { return seq; }
