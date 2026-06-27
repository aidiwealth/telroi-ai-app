// POST /api/voice/token -> a browser-voice token for the signed-in tenant's
// assigned provider, so the dialer can place a real in-browser call.
import { requireTenant, apiError } from '~/server/utils/api';
import { voiceTokenFor } from '~/server/utils/voice-token';
import { resolveLiveCallProvider } from '~/server/utils/live-call-provider';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const body = await readBody<any>(event).catch(() => ({}));
  const selectedFrom = (body?.from || '').trim();
  // Use the tenant's default vendor, preferring the customer's SELECTED from-number
  // so routing follows the number the customer chose to call from.
  const dial = await resolveLiveCallProvider({ tenantId: s.tenantId, configuredProvider: 'auto', preferredFromNumber: selectedFrom || null });
  if (dial.provider === 'telroi') {
    try {
      const { ensureWebrtcEndpoint } = await import('~/server/utils/provision-agent');
      await ensureWebrtcEndpoint(s.tenantId);
    } catch (e: any) {
      throw apiError('voice_not_configured', e?.message || 'Browser calling could not be set up. Try again.', 503);
    }
  }
  // Resolve the from-number's BOUND vendor (set by admin in inventory) to a PBX
  // dial prefix, so browser calls route out the correct Asterisk trunk WITHOUT
  // the customer ever dealing with routes. ruach->81, kasooko->82, sotel->83.
  let dialPrefix = '';
  try {
    const lookupNum = selectedFrom || dial.fromNumber;
    if (lookupNum) {
      const { useDb, schema } = await import('~/server/db');
      const { and, eq } = await import('drizzle-orm');
      const db = useDb();
      const [sub] = await db.select().from(schema.numberSubscriptions)
        .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId), eq(schema.numberSubscriptions.telnum, lookupNum)))
        .limit(1);
      const raw = sub?.provider || '';
      dialPrefix = raw === 'ruach' ? '81' : raw === 'kasooko' ? '82' : raw === 'sotel' ? '83' : '';
    }
  } catch { /* no prefix -> default routing */ }

  try {
    const tok = await voiceTokenFor(dial.provider, `tenant_${s.tenantId}_${s.userId}`);
    return { ...tok, fromNumber: dial.fromNumber, providerReady: dial.ready, dialPrefix };
  } catch (e: any) {
    throw apiError('voice_not_configured', e?.message || 'Voice provider not configured', 503);
  }
});
