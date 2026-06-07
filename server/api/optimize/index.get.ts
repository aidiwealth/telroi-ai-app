// GET /api/optimize -> aggregated call-quality intelligence across every
// provider this tenant uses (Telroi PBX + any connected carriers).
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { loadTenant } from '~/server/utils/tenant';
import { TelroiClient } from '~/server/utils/telroi/client';
import { decrypt } from '~/server/utils/crypto';
import { telroiQuality, twilioQuality, telnyxQuality, type QualityResult } from '~/server/utils/optimize';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const period = (getQuery(event).period as string) || 'month';
  const results: QualityResult[] = [];

  // 1. Telroi PBX operational metrics from call history (simulated in sandbox).
  try {
    const { telroiFor } = await import('~/server/utils/tenant');
    const client = await telroiFor(s.tenantId);
    const calls = await client.historyJson({ period, limit: 500, processMissed: true });
    results.push(telroiQuality(calls as any[]));
  } catch (e: any) {
    results.push({ provider: 'telroi', hasCarrierGrade: false, metrics: [], note: `Telroi history unavailable: ${e?.message || e}` });
  }

  // 2. Connected carriers — real carrier-grade metrics where available.
  const db = useDb();
  const providers = await db.select().from(schema.voiceProviders).where(eq(schema.voiceProviders.tenantId, s.tenantId));
  for (const p of providers) {
    if (!p.credentialsEnc) continue;
    const creds = JSON.parse(decrypt(p.credentialsEnc));
    if (p.kind === 'twilio') results.push(await twilioQuality(creds));
    else if (p.kind === 'telnyx') results.push(await telnyxQuality(creds));
  }

  // Estate-level summary.
  const allMetrics = results.flatMap((r) => r.metrics);
  const avgScore = allMetrics.length ? Math.round(allMetrics.reduce((s, m) => s + m.score, 0) / allMetrics.length) : null;
  const atRisk = allMetrics.filter((m) => m.grade === 'D' || m.grade === 'F').length;

  return {
    summary: { avgScore, totalRoutes: allMetrics.length, atRisk, hasCarrierGrade: results.some((r) => r.hasCarrierGrade) },
    results
  };
});
