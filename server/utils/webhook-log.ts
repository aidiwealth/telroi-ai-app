// server/utils/webhook-log.ts
// A record of every webhook that reaches us.
//
// Written before the signature is verified, deliberately: a rejected
// notification and one that never arrived look identical from the outside, and
// telling them apart is most of the work when a payment doesn't land. The body
// is truncated and never contains a secret — signatures live in headers, which
// we don't store.
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

const EXCERPT = 600;

export async function recordWebhook(input: {
  provider: string; raw?: string | null; eventType?: string | null;
}): Promise<string | null> {
  try {
    const [row] = await useDb().insert(schema.webhookEvents).values({
      provider: input.provider,
      eventType: input.eventType || null,
      bodyExcerpt: input.raw ? input.raw.slice(0, EXCERPT) : null
    }).returning({ id: schema.webhookEvents.id });
    return row?.id || null;
  } catch (e: any) {
    // Never let bookkeeping break the thing it is keeping books on.
    console.error('[webhook-log] could not record:', e?.message);
    return null;
  }
}

export async function finishWebhook(id: string | null, patch: {
  outcome: 'accepted' | 'rejected' | 'ignored' | 'error';
  signatureOk?: boolean; tenantId?: string | null; detail?: string | null; eventType?: string | null;
}): Promise<void> {
  if (!id) return;
  try {
    await useDb().update(schema.webhookEvents).set({
      outcome: patch.outcome,
      signatureOk: patch.signatureOk ?? null,
      tenantId: patch.tenantId ?? null,
      detail: patch.detail ? String(patch.detail).slice(0, 300) : null,
      ...(patch.eventType ? { eventType: patch.eventType } : {})
    }).where(eq(schema.webhookEvents.id, id));
  } catch (e: any) {
    console.error('[webhook-log] could not finish:', e?.message);
  }
}
