// GET /api/admin/support/members -> operators who can take a support call.
//
// Read from sip_endpoints rather than memberships: a support operator is given an
// endpoint with their user id in its meta and never gets a memberships row, so
// querying memberships returned nobody however many operators were connected.
// Widget guest slots are excluded — they aren't people.
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const rows = await useDb().select({
    id: schema.sipEndpoints.id,
    label: schema.sipEndpoints.label,
    sipUsername: schema.sipEndpoints.sipUsername,
    meta: schema.sipEndpoints.meta
  }).from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, ws.tenantId), isNotNull(schema.sipEndpoints.sipUsername)));

  const withUser = rows.filter((r) => (r.meta as any)?.userId && !/^widget-guest/i.test(r.label || ''));

  // Their email, from platform_admins. meta.userId is a platform admin id, so
  // the address is one join away — and "user-5f9075ce" is a SIP endpoint label,
  // not a person: an operator choosing from that list is guessing which
  // colleague they are adding.
  const ids = withUser.map((r) => (r.meta as any).userId as string);
  const admins = ids.length
    ? await useDb().select({ id: schema.platformAdmins.id, email: schema.platformAdmins.email })
        .from(schema.platformAdmins).where(inArray(schema.platformAdmins.id, ids))
    : [];
  const emailById = new Map(admins.map((a) => [a.id, a.email]));

  const members = withUser.map((r) => {
    const uid = (r.meta as any).userId as string;
    const email = emailById.get(uid) || null;
    return {
      userId: uid,
      name: email || r.label || r.sipUsername,
      email,
      sipUsername: r.sipUsername
    };
  });

  return { members };
});
