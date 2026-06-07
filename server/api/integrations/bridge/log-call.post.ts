// POST /api/integrations/bridge/log-call  { key, phone, direction, durationSec, outcome, startedAt, notes }
// Called by the in-CRM embed panel (and Telroi's own call pipeline) to log a
// completed call. Records it locally and fans out to every connected CRM.
// Authenticated by the tenant widget key.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { logCallToCrms } from '~/server/utils/integrations/events';

const Body = z.object({
  key: z.string(),
  phone: z.string().min(3),
  direction: z.enum(['inbound', 'outbound']),
  durationSec: z.number().int().min(0).default(0),
  outcome: z.string().optional(),
  startedAt: z.string().optional(),
  notes: z.string().optional(),
  recordingUrl: z.string().optional()
});

export default defineEventHandler(async (event) => {
  setHeader(event, 'access-control-allow-origin', '*');
  const { rateLimit, clientIp } = await import('~/server/utils/api');
  rateLimit('bridge_logcall_ip', clientIp(event), 120, 60 * 1000);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) { setResponseStatus(event, 400); return { error: 'invalid payload' }; }
  const db = useDb();
  let tenant: { id: string } | undefined;
  try {
    [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.widgetKey, p.data.key)).limit(1);
  } catch { setResponseStatus(event, 503); return { error: 'temporarily unavailable' }; }
  if (!tenant) { setResponseStatus(event, 401); return { error: 'invalid key' }; }

  await logCallToCrms(tenant.id, {
    phone: p.data.phone, direction: p.data.direction, durationSec: p.data.durationSec,
    outcome: p.data.outcome, startedAt: p.data.startedAt ? new Date(p.data.startedAt) : new Date(),
    notes: p.data.notes, recordingUrl: p.data.recordingUrl
  });
  return { ok: true };
});
