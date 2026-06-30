// GET /api/voice/calls/export -> CSV of the client's call history.
// Forwards the same filters the calls page uses (period/type/date range) so the
// export matches what the user is viewing, resolves agent names, and is capped
// at EXPORT_MAX_ROWS with a trailing note if the cap was hit.
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
import { csvRow, EXPORT_MAX_ROWS } from '~/server/utils/csv-export';
import { resolveAgentNames } from '~/server/utils/agent-names';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const q = getQuery(event);
  const client = await telroiFor(s.tenantId);

  const period = (q.period as string) || 'month';
  const calls = await client.historyJson({
    period,
    type: q.type as string,
    start: q.start as string,
    end: q.end as string,
    user: q.user as string,
    limit: EXPORT_MAX_ROWS,
    processMissed: true
  }).catch(() => [] as any[]);

  await resolveAgentNames(s.tenantId, calls as any[]);

  setResponseHeaders(event, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="calls-${period}-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store'
  });

  let out = csvRow(['Date', 'Direction', 'Status', 'From/Client', 'Agent', 'Number', 'Wait (s)', 'Duration (s)', 'Rating']);
  const rows = (calls || []).slice(0, EXPORT_MAX_ROWS);
  for (const c of rows) {
    const direction = c.type === 'in' ? 'Inbound' : 'Outbound';
    const number = c.diversion || c.destination || '';
    out += csvRow([c.start, direction, c.status, c.client, c.user_name || c.user || '', number, c.wait ?? '', c.duration ?? '', c.rating ?? '']);
  }
  if ((calls || []).length >= EXPORT_MAX_ROWS) {
    out += csvRow([`Note: export capped at ${EXPORT_MAX_ROWS} rows; narrow the date range for the rest.`]);
  }
  return out;
});
