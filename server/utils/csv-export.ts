// server/utils/csv-export.ts
// Safe CSV export helpers. Two protections against large-dataset crashes:
//   1) a hard 30-day window on every export (enforced server-side, not trusted
//      from the client), and
//   2) streaming rows in batches to the HTTP response instead of building one
//      giant string/array in memory.
import type { H3Event } from 'h3';

export const EXPORT_WINDOW_DAYS = 30;
export const EXPORT_MAX_ROWS = 50000; // absolute ceiling regardless of window

/** The earliest timestamp an export may include (now - 30 days). */
export function exportSince(): Date {
  return new Date(Date.now() - EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Guard against CSV injection (Excel formula execution) and escaping.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\n';
}

/** Prepare the response for a streamed CSV download. */
export function beginCsv(event: H3Event, filename: string, headers: string[]) {
  setResponseHeaders(event, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });
  return csvRow(headers);
}

/**
 * Stream rows from an async batch-fetcher to the response, capped at
 * EXPORT_MAX_ROWS. fetchBatch(offset, limit) returns up to `limit` rows; an
 * empty array ends the stream. This keeps memory flat for large datasets.
 */
export async function streamCsv(
  event: H3Event,
  filename: string,
  headers: string[],
  toCells: (row: any) => unknown[],
  fetchBatch: (offset: number, limit: number) => Promise<any[]>
) {
  const BATCH = 1000;
  const { Readable } = await import('node:stream');
  let offset = 0;
  let done = false;
  let sentHeader = false;

  const stream = new Readable({
    async read() {
      try {
        if (done) { this.push(null); return; }
        if (!sentHeader) { this.push(beginCsv(event, filename, headers)); sentHeader = true; }
        const remaining = EXPORT_MAX_ROWS - offset;
        if (remaining <= 0) { done = true; this.push(null); return; }
        const rows = await fetchBatch(offset, Math.min(BATCH, remaining));
        if (!rows.length) { done = true; this.push(null); return; }
        let chunk = '';
        for (const r of rows) chunk += csvRow(toCells(r));
        offset += rows.length;
        if (rows.length < BATCH) done = true;
        this.push(chunk);
        if (done) this.push(null);
      } catch (e) {
        this.destroy(e as Error);
      }
    }
  });

  return sendStream(event, stream);
}
