// POST /api/webhooks/twilio/recording — a finished recording.
//
// Its own endpoint rather than another branch in the voice handler: that one
// decides how calls are routed, and a fault while fetching several megabytes of
// audio has no business anywhere near it.
//
// Fetched and stored rather than left with Twilio. Their URLs need account
// credentials and their storage is theirs — a recording that lives only on a
// carrier is one you lose when you leave them.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const p: any = await readBody(event).catch(() => ({}));
  const sid = p.CallSid;
  const url = p.RecordingUrl;
  const status = p.RecordingStatus;

  // 'absent' is Twilio saying the call was too short or silent to record. Not a
  // failure, and not worth a row.
  if (!sid || !url || status !== 'completed') return { ok: true };

  void (async () => {
    try {
      const db = useDb();
      const [ev] = await db.select().from(schema.callEvents)
        .where(eq(schema.callEvents.callid, sid)).limit(1);
      if (!ev?.tenantId) { console.warn(`[twilio] recording for unknown call ${sid}`); return; }

      // voiceCredentials, which is what everything else here uses — an earlier
      // draft called a twilioCreds() that does not exist, and a dynamic import
      // of a missing function builds cleanly and fails only when it runs.
      const { voiceCredentials } = await import('~/server/utils/voice-credentials');
      const { twilio: creds }: any = await voiceCredentials();
      if (!creds?.accountSid) { console.error('[twilio] no credentials to fetch a recording with'); return; }

      // Their URL has no extension; .wav asks for the audio rather than JSON
      // about it.
      const res = await fetch(`${url}.wav`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64') },
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) { console.error(`[twilio] recording fetch failed: HTTP ${res.status}`); return; }
      const audio = Buffer.from(await res.arrayBuffer());

      const cfg = useRuntimeConfig() as any;
      await $fetch('/api/voice/recording/store', {
        method: 'POST',
        headers: { 'x-telroi-internal': (cfg.internalSecret || cfg.provisionAgentSecret) as string },
        body: {
          tenantId: ev.tenantId, callid: sid,
          telnum: ev.telnum || null, direction: ev.direction || null, phone: ev.phone || null,
          durationSeconds: p.RecordingDuration ? Number(p.RecordingDuration) : null,
          carrier: 'twilio',
          audioBase64: audio.toString('base64')
        }
      });
      console.log(`[twilio] recording stored for ${sid}`);
    } catch (e: any) {
      console.error('[twilio] recording store failed:', e?.message || e);
    }
  })();

  return { ok: true };
});
