import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
import { telroiQuality, twilioQuality, telnyxQuality, aiAgentPerformance, type QualityResult } from '~/server/utils/optimize';
import { decrypt } from '~/server/utils/crypto';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const period = (getQuery(event).period as string) || 'month';
  const results: QualityResult[] = [];
  try {
    const { telroiFor } = await import('~/server/utils/tenant');
    const client = await telroiFor(ws.tenantId);
    const calls = await client.historyJson({ period, limit: 500, processMissed: true });
    results.push(telroiQuality(calls as any[]));
  } catch (e: any) {
    results.push({ provider: 'telroi', hasCarrierGrade: false, metrics: [], note: `Telroi history unavailable: ${e?.message || e}` });
  }
  const db = useDb();
  const providers = await db.select().from(schema.voiceProviders).where(eq(schema.voiceProviders.tenantId, ws.tenantId));
  for (const p of providers) {
    if (!p.credentialsEnc) continue;
    try {
      const creds = JSON.parse(decrypt(p.credentialsEnc));
      if (p.kind === 'twilio') results.push(await twilioQuality(creds, period));
      else if (p.kind === 'telnyx') results.push(await telnyxQuality(creds, period));
    } catch { /* */ }
  }
  const sinceDays = period === 'week' ? 7 : 30;
  const aiAgents = await aiAgentPerformance(db, schema, ws.tenantId, sinceDays);
  return { period, results, aiAgents };
});
