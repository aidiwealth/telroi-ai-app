// POST /api/integrations/import { provider } -> pull contacts from the CRM into Telroi.
import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { importContacts } from '~/server/utils/integrations/import';
import { SUPPORTED_PROVIDERS } from '~/server/utils/integrations/providers';
const Body = z.object({ provider: z.enum(SUPPORTED_PROVIDERS) });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'provider required');
  if (p.data.provider === 'zapier') throw apiError('invalid', 'Zapier has no contacts to import', 400);
  try {
    const r = await importContacts(s.tenantId, p.data.provider);
    return { ok: true, ...r };
  } catch (e: any) { throw apiError('import_failed', e?.message || 'Import failed', 502); }
});
