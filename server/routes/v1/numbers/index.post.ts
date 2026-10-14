// POST /v1/numbers { inventory_id, channels?, categories?, indemnity_document_id? }
// Buy a number into the workspace's shared pool. Requires numbers:write and an
// approved business verification (carriers hold Telroi to who is behind a
// number). Bills the PARENT tenant's wallet. Numbers are shared across the
// tenant's sub-accounts; rotation applies as configured.
//
// Self-contained purchase core: mirrors the dashboard's claim -> compliance ->
// charge -> subscription, deliberately NOT sharing code with the dashboard
// endpoint so this cannot destabilise that live money path.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getOrCreateWallet, debit, canAfford } from '~/server/utils/wallet';
import { getPricing, toCurrencyMinor } from '~/server/utils/pricing';
import { logEvent } from '~/server/utils/logs';
import { SENSITIVE_KEYS as SENSITIVE } from '~/server/utils/number-categories';

const Body = z.object({
  inventory_id: z.string().uuid(),
  channels: z.number().int().min(1).max(50).default(1),
  categories: z.array(z.string().max(32)).min(1).optional(),
  indemnity_document_id: z.string().uuid().optional()
});

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'numbers:write')) throw apiError('forbidden', 'Key lacks numbers:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'inventory_id is required');
  const db = useDb();

  const categories = p.data.categories?.length ? p.data.categories : ['general'];
  const sensitive = categories.filter((c) => SENSITIVE.includes(c));
  if (sensitive.length) {
    if (!p.data.indemnity_document_id) throw apiError('indemnity_required', 'This use needs the Number Use Indemnity accepted first.', 428);
    const [doc] = await db.select({ isCurrent: schema.legalDocuments.isCurrent })
      .from(schema.legalDocuments).where(eq(schema.legalDocuments.id, p.data.indemnity_document_id)).limit(1);
    if (!doc) throw apiError('indemnity_required', 'Unknown indemnity version.', 428);
    if (!doc.isCurrent) throw apiError('indemnity_stale', 'The indemnity has been updated; accept the current version.', 409);
  }

  // Carrier requirement: the tenant must be verified. Sub-accounts inherit the
  // parent's verification (they are not separate legal entities).
  const [comp] = await db.select({ status: schema.compliance.status })
    .from(schema.compliance).where(eq(schema.compliance.tenantId, ctx.tenantId)).limit(1);
  if (comp?.status !== 'approved') {
    throw apiError('compliance_required', 'Business verification must be approved before buying numbers.', 403);
  }

  // Sandbox keys never provision or charge.
  const { isSandbox } = await import('~/server/utils/sandbox');
  const sandbox = ctx.env === 'sandbox' || await isSandbox(ctx.tenantId);

  // Atomically claim the inventory row.
  const [claimed] = await db.update(schema.numberInventory)
    .set({ status: 'sold', soldToTenantId: ctx.tenantId })
    .where(and(eq(schema.numberInventory.id, p.data.inventory_id), eq(schema.numberInventory.status, 'available')))
    .returning();
  if (!claimed) throw apiError('unavailable', 'That number is no longer available', 409);

  // Guard against an existing subscription on the telnum.
  const [existingSub] = await db.select().from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.telnum, claimed.telnum)).limit(1);
  if (existingSub) {
    await db.update(schema.numberInventory).set({ status: 'available', soldToTenantId: null }).where(eq(schema.numberInventory.id, claimed.id));
    throw apiError(existingSub.tenantId === ctx.tenantId ? 'already_owned' : 'unavailable',
      existingSub.tenantId === ctx.tenantId ? 'You already have this number.' : 'That number is no longer available.', 409);
  }

  try {
    const wallet = await getOrCreateWallet(ctx.tenantId);
    const pricing = await getPricing(ctx.tenantId);
    const didUsd = claimed.monthlyUsdMinorOverride ?? pricing.didMonthlyUsdMinor;
    const didMinor = toCurrencyMinor(didUsd, wallet.currency as any, pricing.ngnPerUsd);
    const chMinor = toCurrencyMinor(pricing.channelMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd) * p.data.channels;
    const total = didMinor + chMinor;
    const next = new Date(); next.setDate(next.getDate() + 30);

    if (!sandbox) {
      if (!(await canAfford(ctx.tenantId, total))) {
        await db.update(schema.numberInventory).set({ status: 'available', soldToTenantId: null }).where(eq(schema.numberInventory.id, claimed.id));
        throw apiError('insufficient_funds', 'Wallet balance too low. Load the wallet and try again.', 402);
      }
      const ref = `numbuy_${claimed.telnum}_${Date.now()}`;
      await debit({ tenantId: ctx.tenantId, amountMinor: total, reason: 'number_purchase', reference: ref,
        meta: { telnum: claimed.telnum, region: claimed.region, channels: p.data.channels, via: 'api', subAccountId: ctx.subAccountId } });
    }

    const [sub] = await db.insert(schema.numberSubscriptions).values({
      tenantId: ctx.tenantId, telnum: claimed.telnum, region: claimed.region, provider: claimed.provider,
      channels: p.data.channels, nextBillingAt: next, lastBilledAt: new Date(), useCategories: categories
    }).returning();

    if (p.data.indemnity_document_id && sensitive.length) {
      await db.insert(schema.legalAcceptances).values({
        tenantId: ctx.tenantId, documentId: p.data.indemnity_document_id, telnum: claimed.telnum,
        inventoryId: p.data.inventory_id, declaredCategories: categories,
        userAgent: (getHeader(event, 'user-agent') || 'API').slice(0, 300)
      }).catch((e: any) => console.error('[v1/numbers] acceptance not recorded:', e?.message));
    }

    await logEvent({ tenantId: ctx.tenantId, kind: 'system', action: 'number.purchased',
      summary: `[api] Bought ${claimed.telnum} (${claimed.region}, ${p.data.channels}ch)${ctx.subAccountId ? ' for sub-account ' + ctx.subAccountId : ''}` });

    return { object: 'number', livemode: !sandbox, id: sub.id, telnum: claimed.telnum, region: claimed.region,
      channels: p.data.channels, charged_minor: sandbox ? 0 : total, currency: wallet.currency, simulated: sandbox };
  } catch (e: any) {
    await db.update(schema.numberInventory).set({ status: 'available', soldToTenantId: null }).where(eq(schema.numberInventory.id, claimed.id));
    throw e;
  }
});
