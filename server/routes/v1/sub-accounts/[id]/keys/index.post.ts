// POST /v1/sub-accounts/{id}/keys  { name?, scopes?, env? }
// Mint an API key that acts for this sub-account. Parent key only.
// The full key string is returned ONCE here; only its hash is stored.
// scopes default to the caller's own scopes, or ['*'] — unrestricted WITHIN the
// sub-account's own data (the visibility filter bounds what that key can see).
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { sha256 } from '~/server/utils/crypto';
import { randomBytes } from 'node:crypto';

const Body = z.object({
  name: z.string().min(1).max(120).optional(),
  scopes: z.array(z.string().max(48)).max(32).optional(),
  env: z.enum(['live','test']).optional()
});

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'subaccounts:write')) throw apiError('forbidden', 'Key lacks subaccounts:write', 403);
  if (ctx.subAccountId) throw apiError('forbidden', 'A sub-account key cannot issue keys', 403);
  const id = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid body');
  const db = useDb();

  const [sa] = await db.select().from(schema.subAccounts)
    .where(and(eq(schema.subAccounts.id, id), eq(schema.subAccounts.parentTenantId, ctx.tenantId))).limit(1);
  if (!sa) throw apiError('not_found', 'Sub-account not found', 404);

  const prefix = p.data.env === 'test' ? 'tlr_test' : 'tlr_live';
  const secret = randomBytes(24).toString('hex');           // 48 hex chars
  const raw = `${prefix}_${secret}`;
  const scopes = p.data.scopes && p.data.scopes.length ? p.data.scopes : ['*'];

  const [row] = await db.insert(schema.apiKeys).values({
    tenantId: ctx.tenantId,                 // PARENT tenant — billing + resources
    subAccountId: sa.id,
    name: p.data.name || `${sa.name} key`,
    keyHash: sha256(raw),
    prefix,
    last4: raw.slice(-4),
    scopes
  }).returning();

  return {
    object: 'api_key',
    id: row.id,
    sub_account_id: sa.id,
    name: row.name,
    scopes,
    key: raw,                               // shown once — store it now
    livemode: prefix === 'tlr_live'
  };
});
