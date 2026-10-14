// POST /api/admin/clients/:domain/use-own-number { enabled }
//
// Which number a workspace's OTP and notification calls go out on: their own
// purchased DID, or the platform's shared one.
//
// Own by default, because a carrier blocks a source number carrying heavy
// traffic and one shared number carrying every client's verification calls is
// how it gets blocked for all of them at once — a Kasooko trunk refused a call
// with "Source number blacklisted", which is precisely that failure arriving.
//
// The switch exists for when their own number is the problem: a fresh DID the
// carrier has not propagated, or one blocked for reasons that take days to
// clear. Then an operator moves them to the shared number rather than leaving
// them unable to verify anybody.
//
// Platform admin rather than superadmin: this is what somebody does at the
// moment a client reports failing calls, and waiting for a superadmin means a
// client who cannot sign anybody up until then.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

// Two things, because they are set in the same place and answer the same
// question: whether this workspace uses its own numbers, and if so whether an
// operator has pinned it to one of them.
const Body = z.object({
  enabled: z.boolean().optional(),
  pinned: z.string().max(32).nullable().optional(),
  securityNotice: z.boolean().optional(),
  subAccountsEnabled: z.boolean().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const domain = getRouterParam(event, 'domain') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw createError({ statusCode: 400, statusMessage: 'enabled is required' });

  // The same resolver the other client endpoints use. Matching on slug myself
  // would have found nothing and returned 404 for every workspace, which looks
  // like a toggle that quietly does not work.
  const { resolveTenantByDomain } = await import('~/server/utils/resolve-tenant');
  const t = await resolveTenantByDomain(decodeURIComponent(domain));
  if (!t) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' });
  const db = useDb();

  const patch: any = {};
  if (p.data.enabled !== undefined) patch.useOwnNumber = p.data.enabled;
  if (p.data.pinned !== undefined) patch.otpCallerPinned = p.data.pinned || null;
  if (p.data.securityNotice !== undefined) patch.otpSecurityNotice = p.data.securityNotice;
  if (p.data.subAccountsEnabled !== undefined) patch.subAccountsEnabled = p.data.subAccountsEnabled;
  if (!Object.keys(patch).length) return { ok: true, unchanged: true };
  await db.update(schema.tenants).set(patch).where(eq(schema.tenants.id, t.id));
  console.log(`[client] ${t.name} caller id changed (by ${admin.email}): ${JSON.stringify(patch)}`);
  return { ok: true, ...patch };
});
