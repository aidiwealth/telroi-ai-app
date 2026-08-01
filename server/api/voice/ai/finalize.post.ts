// server/api/voice/ai/finalize.post.ts — called once when an AI call ends.
// Sums the call's ai_usage rows and writes ONE sandbox ledger summary (track
// now, bill later). Flip sandboxLedgerEntry -> debit to bill for real.
import { eq, and } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { sandboxLedgerEntry } from '~/server/utils/wallet';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const body = await readBody(event).catch(() => ({} as any));
  const { tenantId, callId } = body || {};
  if (!tenantId || !callId) throw createError({ statusCode: 400, statusMessage: 'tenantId and callId required' });

  const rows = await useDb().select().from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.tenantId, tenantId), eq(schema.aiUsage.callId, callId)));
  if (!rows.length) return { ok: true, costMinorUsd: 0, turns: 0 };

  const totals = rows.reduce((a, r) => ({
    cost: a.cost + (r.costNanoUsd || 0), stt: a.stt + (r.sttSeconds || 0),
    inTok: a.inTok + (r.llmInputTokens || 0), outTok: a.outTok + (r.llmOutputTokens || 0),
    ttsChars: a.ttsChars + (r.ttsChars || 0), managed: a.managed || r.managed
  }), { cost: 0, stt: 0, inTok: 0, outTok: 0, ttsChars: 0, managed: false });

  // Charged in cents, accrued in nano. A call costing less than a cent rounds to
  // nothing rather than being billed, which is the right way round: better to
  // forgo a fraction than to invent one.
  const costMinor = Math.round(totals.cost / 1e7);
  if (totals.managed && costMinor > 0) {
    await sandboxLedgerEntry({
      tenantId, amountMinor: costMinor, reason: 'ai_managed', reference: `ai_${callId}`,
      meta: { callId, turns: rows.length, sttSeconds: totals.stt, llmInputTokens: totals.inTok, llmOutputTokens: totals.outTok, ttsChars: totals.ttsChars, unit: 'usd_cents' }
    });
  }
  return { ok: true, costMinorUsd: costMinor, turns: rows.length };
});
