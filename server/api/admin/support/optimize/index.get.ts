// GET /api/admin/support/optimize -> unified optimize report for the support workspace.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';
import { buildOptimizeReport, twilioQuality, telnyxQuality } from '~/server/utils/optimize';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const period = (getQuery(event).period as string) || 'month';
  const sinceDays = period === 'week' ? 7 : period === 'quarter' ? 90 : 30;
  const db = useDb();

  const report = await buildOptimizeReport(db, schema, ws.tenantId, sinceDays);

  const providers = await db.select().from(schema.voiceProviders).where(eq(schema.voiceProviders.tenantId, ws.tenantId));
  const notes: string[] = [];
  for (const p of providers) {
    if (!p.credentialsEnc) continue;
    try {
      const creds = JSON.parse(decrypt(p.credentialsEnc));
      const q = p.kind === 'twilio' ? await twilioQuality(creds) : p.kind === 'telnyx' ? await telnyxQuality(creds) : null;
      if (q) {
        report.overview.hasCarrierGrade = report.overview.hasCarrierGrade || q.hasCarrierGrade;
        if (q.note) notes.push(`${p.kind}: ${q.note}`);
        for (const m of q.metrics) {
          report.routes.push({
            route: `carrier:${p.kind}:${m.scope}`, label: m.label, carrier: p.kind, direction: 'in',
            calls: m.calls, answerRate: m.answerRate ?? 0, avgWaitSec: m.avgWaitSec, avgDurationSec: m.avgDurationSec,
            avgRating: m.avgRating, score: m.score, grade: m.grade, signals: m.signals
          });
        }
      }
    } catch { notes.push(`${p.kind}: metrics unavailable`); }
  }
  report.carrierNotes = notes;
  report.routes.sort((a, b) => a.score - b.score);
  report.overview.totalRoutes = report.routes.length;
  report.overview.routesAtRisk = report.routes.filter((r) => r.grade === 'D' || r.grade === 'F').length;

  return { period, ...report };
});
