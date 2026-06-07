// POST /widget/session { key, name, phone, visitorType, externalUserId, pageUrl }
// Captures the visitor as a CRM lead and opens a Live Call session. CORS-open.
import { z } from 'zod';
import { tenantByWidgetKey, geoFromEvent } from '~/server/utils/live-call';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  key: z.string(), name: z.string().min(1).max(120), phone: z.string().min(4).max(32),
  visitorType: z.enum(['visitor', 'user']).default('visitor'),
  externalUserId: z.string().optional(), pageUrl: z.string().optional()
});
export default defineEventHandler(async (event) => {
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  const body = await readBody(event);
  const p = Body.safeParse(body);
  if (!p.success) { setResponseStatus(event, 400); return { error: 'invalid' }; }
  const t = await tenantByWidgetKey(p.data.key);
  if (!t) { setResponseStatus(event, 404); return { error: 'invalid_key' }; }

  const db = useDb();
  const geo = geoFromEvent(event);
  // Route to CRM as a lead (only if CRM/Telroi One enabled).
  let contactId: string | null = null;
  try {
    const { hasFeature } = await import('~/server/utils/entitlements');
    if (await hasFeature(t.id, 'crm')) {
      const { upsertContactByPhone } = await import('~/server/utils/crm');
      const c = await upsertContactByPhone(t.id, p.data.phone, {
        name: p.data.name, source: 'web_call', status: 'lead',
        city: geo.city, region: geo.region, country: geo.country
      });
      contactId = c?.id || null;
    }
  } catch { /* lead capture best-effort */ }

  const [session] = await db.insert(schema.liveCallSessions).values({
    tenantId: t.id, visitorName: p.data.name, visitorPhone: p.data.phone,
    visitorType: p.data.visitorType, externalUserId: p.data.externalUserId || null,
    pageUrl: p.data.pageUrl || null, country: geo.country || null, region: geo.region || null, city: geo.city || null,
    status: 'opened', contactId
  }).returning();
  return { ok: true, sessionId: session.id };
});
