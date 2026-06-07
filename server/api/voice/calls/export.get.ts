// GET /api/voice/calls/export -> CSV of the client's call history, capped to the
// last 30 days. Call history comes from the PBX (not our DB), so we bound the
// request by period and a max row count rather than DB batching.
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
import { beginCsv, csvRow, EXPORT_MAX_ROWS } from '~/server/utils/csv-export';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const client = await telroiFor(s.tenantId);
  // 'month' ≈ last 30 days; enforce the same window as every other export.
  const calls = await client.historyJson({ period: 'month', limit: EXPORT_MAX_ROWS, processMissed: true })
    .catch(() => [] as any[]);

  setResponseHeaders(event, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store'
  });
  let out = csvRow(['Date', 'Direction', 'Status', 'From/Client', 'Agent', 'Number', 'Wait (s)', 'Duration (s)', 'Rating']);
  for (const c of (calls || []).slice(0, EXPORT_MAX_ROWS)) {
    out += csvRow([c.start, c.type, c.status, c.client, c.user || '', c.diversion || '', c.wait ?? '', c.duration ?? '', c.rating ?? '']);
  }
  return out;
});
