// POST /widget/csat { key, sessionId, score?, comment?, outcome? } -> save CSAT.
// Works after BOTH successful and failed calls. CORS-open.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { tenantByWidgetKey } from '~/server/utils/live-call';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  key: z.string(), sessionId: z.string().uuid(),
  score: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  outcome: z.enum(['answered', 'missed', 'failed', 'abandoned']).optional(),
  seconds: z.number().int().min(0).optional()
});
export default defineEventHandler(async (event) => {
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  const p = Body.safeParse(await readBody(event));
  if (!p.success) { setResponseStatus(event, 400); return { error: 'invalid' }; }
  const t = await tenantByWidgetKey(p.data.key);
  if (!t) { setResponseStatus(event, 404); return { error: 'invalid_key' }; }
  const db = useDb();
  await db.update(schema.liveCallSessions)
    .set({
      csatScore: p.data.score ?? null, csatComment: p.data.comment || null,
      outcome: p.data.outcome || 'answered',
      status: 'ended', endedAt: new Date()
    })
    .where(and(eq(schema.liveCallSessions.id, p.data.sessionId), eq(schema.liveCallSessions.tenantId, t.id)));
  // Update the linked call-log event status to reflect the real outcome, and
  // charge the call to this tenant's wallet (client wallet, or support wallet
  // for the support workspace) on the provider that was resolved at call time.
  try {
    const [sess] = await db.select().from(schema.liveCallSessions).where(eq(schema.liveCallSessions.id, p.data.sessionId)).limit(1);
    if (sess) {
      const st = (p.data.outcome === 'failed' || p.data.outcome === 'abandoned') ? 'failed' : 'completed';
      const [ev] = await db.update(schema.callEvents).set({ status: st, duration: p.data.seconds || 0 }).where(eq(schema.callEvents.callid, `lc_${sess.id}`)).returning();
      // Bill only answered calls with real duration.
      if ((p.data.outcome === 'answered' || !p.data.outcome) && (p.data.seconds || 0) > 0) {
        const { chargeCall } = await import('~/server/utils/call-billing');
        const provider = (ev?.raw as any)?.provider || (ev?.carrier as string) || undefined;
        await chargeCall({ tenantId: t.id, callId: `lc_${sess.id}`, seconds: p.data.seconds || 0, provider, source: 'live_call' });
      }
    }
  } catch { /* */ }
  return { ok: true };
});
