// GET /api/admin/support/ai/connections/:id/languages
// Ask a speech provider what it can actually transcribe.
//
// The language list offers Yoruba, Igbo and Hausa, but coverage varies enormously
// between providers — and a client whose provider can't hear their language gets
// silence on a live call rather than an error anywhere they'd see it. Better to
// ask than to let them find out mid-conversation.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';

// A public sample, so the check costs nothing and needs no upload. The audio is
// English — we're asking whether the language code is accepted, not judging what
// comes back.
const SAMPLE = 'gs://cloud-samples-tests/speech/brooklyn.flac';
const CHECK = ['en-US', 'en-NG', 'fr-FR', 'es-ES', 'sw-KE', 'yo-NG', 'ig-NG', 'ha-NG', 'am-ET', 'zu-ZA', 'af-ZA'];

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const [conn] = await useDb().select().from(schema.aiConnections)
    .where(eq(schema.aiConnections.id, id)).limit(1);
  if (!conn) throw apiError('not_found', 'Connection not found', 404);
  if (conn.provider !== 'google-cloud') {
    throw apiError('unsupported', 'Only Google Cloud connections can be checked this way for now.', 400);
  }

  const key = decrypt(conn.apiKeyEnc);
  const results: Record<string, { ok: boolean; detail?: string }> = {};

  for (const lang of CHECK) {
    try {
      const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { languageCode: lang }, audio: { uri: SAMPLE } }),
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok) { results[lang] = { ok: true }; continue; }
      const body = await res.text().catch(() => '');
      const msg = (() => { try { return JSON.parse(body)?.error?.message || body; } catch { return body; } })();
      results[lang] = { ok: false, detail: String(msg).slice(0, 160) };
    } catch (e: any) {
      results[lang] = { ok: false, detail: e?.message || 'request failed' };
    }
  }

  return { provider: conn.provider, results };
});
