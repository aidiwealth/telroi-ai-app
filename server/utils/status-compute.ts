// server/utils/status-compute.ts
// Derives each component's LIVE status and 90-day uptime from recorded checks
// (status_checks) — never from typed input. Merges the predetermined registry
// (title, default description) with the admin-editable row (description, sort
// order, manual override).
import { and, eq, gte, desc } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { STATUS_COMPONENTS, type ProbeState } from './status-registry';

export interface ComputedComponent {
  key: string;
  title: string;          // from registry (fixed)
  description: string;    // admin override or registry default
  status: ProbeState | 'maintenance';
  uptime90: number | null; // basis points (9998 = 99.98%), null if no data
  sortOrder: number;
  recent: Array<'up' | 'down' | 'unknown'>; // newest-last, for the bar
  lastCheckedAt: string | null;
  monitored: boolean;     // false if we only have 'unknown' / no checks
}

const rank: Record<string, number> = { operational: 0, maintenance: 1, degraded: 2, unknown: 2, major_outage: 4 };

export async function computeStatus(): Promise<{ components: ComputedComponent[]; overall: string }> {
  const db = useDb();
  // admin-editable rows keyed by component key
  const rows = await db.select().from(schema.statusComponents);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const out: ComputedComponent[] = [];

  for (const def of STATUS_COMPONENTS) {
    const row = rowByKey.get(def.key);
    // all checks in the last 90 days for uptime; last ~90 for the bar
    const checks = await db.select().from(schema.statusChecks)
      .where(and(eq(schema.statusChecks.componentKey, def.key), gte(schema.statusChecks.checkedAt, since)))
      .orderBy(desc(schema.statusChecks.checkedAt)).limit(2000);

    const known = checks.filter((c) => c.state !== 'unknown');
    const okCount = known.filter((c) => c.ok).length;
    const uptime90 = known.length ? Math.round((okCount / known.length) * 10000) : null;

    // current state = latest check's state (or unknown if none)
    const latest = checks[0];
    let status: ComputedComponent['status'] = latest ? (latest.state as ProbeState) : 'unknown';
    // admin manual override wins (e.g. forced maintenance)
    if (row?.manualStatus) status = row.manualStatus as any;

    // recent segments for the bar, oldest-last → reverse to newest-last
    const recent = checks.slice(0, 90).reverse().map((c) =>
      c.state === 'unknown' ? 'unknown' : (c.ok ? 'up' : 'down')
    ) as Array<'up' | 'down' | 'unknown'>;

    out.push({
      key: def.key,
      title: def.title,
      description: row?.description || def.defaultDescription,
      status,
      uptime90,
      sortOrder: row?.sortOrder ?? STATUS_COMPONENTS.indexOf(def) + 1,
      recent,
      lastCheckedAt: latest ? latest.checkedAt.toISOString() : null,
      monitored: known.length > 0
    });
  }

  out.sort((a, b) => a.sortOrder - b.sortOrder);

  // overall = worst component status (unknown does not raise alarm above degraded)
  let worst = 'operational';
  for (const c of out) if ((rank[c.status] ?? 0) > (rank[worst] ?? 0)) worst = c.status;
  return { components: out, overall: worst };
}
