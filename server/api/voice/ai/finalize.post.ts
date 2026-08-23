// server/api/voice/ai/finalize.post.ts — called once when an AI call ends.
// Sums the call's ai_usage rows and charges the wallet once for the call.
//
// This tracked without billing while managed AI was being proved out. It bills
// now — the platform is live and the vendor costs are real. Sandbox workspaces
// still only see what it would have cost, because debit routes them to a
// sandbox entry itself.
import { eq, and } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { debit, sandboxLedgerEntry } from '~/server/utils/wallet';

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
    // Sandbox sees what it would have cost and keeps its balance. debit does
    // not check this itself — chargeCall checks before calling it, and this
    // does the same rather than assuming.
    const { isSandbox } = await import('~/server/utils/sandbox');
    const sandboxed = await isSandbox(tenantId).catch(() => false);
    const write = sandboxed ? sandboxLedgerEntry : debit;

    // Keyed on the call, so a finalize arriving twice — a retry, or both a
    // hangup and a socket close — charges once.
    await write({
      tenantId, amountMinor: costMinor, reason: 'ai_managed',
      reference: sandboxed ? `sbx_ai_${callId}` : `ai_${callId}`,
      meta: { callId, turns: rows.length, sttSeconds: totals.stt, llmInputTokens: totals.inTok, llmOutputTokens: totals.outTok, ttsChars: totals.ttsChars, unit: 'usd_cents' }
    });
  }
  return { ok: true, costMinorUsd: costMinor, turns: rows.length };
});
