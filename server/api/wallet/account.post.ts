// Creates the workspace's dedicated Monnify reserved account (idempotent —
// returns the existing one if already created). BVN or NIN required by CBN.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { loadTenant } from '~/server/utils/tenant';
import { monnify } from '~/server/utils/monnify';
import { paymentCreds } from '~/server/utils/platform';
import { randomToken } from '~/server/utils/crypto';

const Body = z.object({
  bvn: z.string().regex(/^\d{11}$/).optional(),
  nin: z.string().regex(/^\d{11}$/).optional()
}).refine((d) => d.bvn || d.nin, { message: 'A BVN or NIN is required' });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  // Idempotent: one reserved account per workspace.
  const [existing] = await db.select().from(schema.virtualAccounts)
    .where(eq(schema.virtualAccounts.tenantId, s.tenantId)).limit(1);
  if (existing) return { account: existing, existing: true };

  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'BVN or NIN required');

  const pay = await paymentCreds();
  if (!pay.monnify?.apiKey || !pay.monnify?.contractCode) {
    throw apiError('not_configured', 'Monnify is not configured on this server', 503);
  }

  const tenant = await loadTenant(s.tenantId);
  const accountReference = `tlr-${tenant.slug}-${randomToken(6).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;

  let reserved;
  try {
    reserved = await monnify.reserveAccount({
      apiKey: pay.monnify.apiKey, secretKey: pay.monnify.secretKey, env: pay.mode,
      contractCode: pay.monnify.contractCode,
      accountReference, accountName: `Telroi - ${tenant.name}`,
      customerEmail: s.email, customerName: tenant.name,
      bvn: p.data.bvn, nin: p.data.nin
    });
  } catch (e: any) {
    throw apiError('monnify_error', `Could not reserve account: ${e?.message || e}`, 502);
  }

  const [row] = await db.insert(schema.virtualAccounts).values({
    tenantId: s.tenantId, provider: 'monnify',
    accountReference: reserved.accountReference || accountReference,
    accountName: reserved.primary?.accountName || `Telroi - ${tenant.name}`,
    accountNumber: reserved.primary?.accountNumber || null,
    bankName: reserved.primary?.bankName || 'Moniepoint MFB',
    bankCode: reserved.primary?.bankCode || null,
    accounts: reserved.accounts || []
  }).returning();

  return { account: row, existing: false };
});
