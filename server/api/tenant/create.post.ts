// POST /api/tenant/create  { name, slug, timezone } -> create tenant + owner membership, switch session
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireUser, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { issueSession } from '~/server/utils/session';
import { POLICY_VERSION } from '~/server/utils/policy';
import { sendPolicyEmail } from '~/server/utils/email';
import { randomToken } from '~/server/utils/crypto';

const Body = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  timezone: z.string().default('UTC'),
  country: z.string().min(2),
  sector: z.string().min(2),
  businessPhone: z.string().max(32).optional(),
  acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'You must accept the policy to continue' }) })
});

export default defineEventHandler(async (event) => {
  const s = await requireUser(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', parsed.error.issues[0]?.message || 'Workspace name, slug and policy acceptance required');
  const db = useDb();

  const existing = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, parsed.data.slug)).limit(1);
  if (existing.length) throw apiError('slug_taken', 'That subdomain is taken');

  const [tenant] = await db.insert(schema.tenants).values({
    name: parsed.data.name, slug: parsed.data.slug, timezone: parsed.data.timezone,
    country: parsed.data.country, sector: parsed.data.sector, businessPhone: parsed.data.businessPhone || null,
    onboardingStep: 1,
    policyAcceptedAt: new Date(), policyVersion: POLICY_VERSION,
    unsubToken: randomToken(18)
  }).returning();
  await db.insert(schema.memberships).values({ userId: s.userId, tenantId: tenant.id, role: 'owner' });

  await issueSession(event, { userId: s.userId, email: s.email, tenantId: tenant.id, role: 'owner' });

  // Mirror the new client into Telroi's own (admin) support CRM, so the admin
  // CRM holds every client with their registered business number — and the
  // "Call client" action has a number to dial. Best-effort; never blocks signup.
  if (parsed.data.businessPhone) {
    import('~/server/utils/support').then(async ({ ensureSupportWorkspace }) => {
      const ws = await ensureSupportWorkspace();
      const { upsertContactByPhone } = await import('~/server/utils/crm');
      await upsertContactByPhone(ws.tenantId, parsed.data.businessPhone!, {
        name: tenant.name, company: tenant.name, email: s.email,
        country: parsed.data.country, status: 'customer', source: 'Direct'
      });
    }).catch((e) => console.error('support CRM mirror failed', e));
  }

  // Email the accepted policy copy (best-effort; never blocks signup).
  sendPolicyEmail(s.email, tenant.name).catch((e) => console.error('policy email failed', e));
  // Warm welcome + guided setup checklist (best-effort).
  import('~/server/utils/email').then(({ sendWelcomeEmail }) =>
    sendWelcomeEmail(s.email, { workspace: tenant.name, name: s.email.split('@')[0] })
  ).catch((e) => console.error('welcome email failed', e));

  return { id: tenant.id, name: tenant.name, slug: tenant.slug, onboardingStep: tenant.onboardingStep };
});
