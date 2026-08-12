// control-app/src/recording-upload.ts
// A finished recording, sent to the web app for storage.
//
// The PBX holds no R2 credentials and should not: it is the box most exposed to
// the world, and a bucket key here is a key an intruder gets. The web app has
// them already, so the audio goes there.
import { promises as fs } from 'node:fs';

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.PROVISION_AGENT_SECRET || '';
const DIR = '/var/spool/asterisk/monitor';

function log(...a: unknown[]) { console.log(new Date().toISOString(), '[rec-upload]', ...a); }

/** Wait for a file to stop growing.
 *
 *  MixMonitor holds the file open until the channel is gone, and StasisEnd can
 *  fire a moment before it closes — uploading immediately would catch a
 *  recording missing its last seconds, which is precisely the part somebody
 *  disputes. */
async function settled(path: string, tries = 10): Promise<number> {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    let size = 0;
    try { size = (await fs.stat(path)).size; } catch { return 0; }
    if (size > 0 && size === last) return size;
    last = size;
  }
  return last > 0 ? last : 0;
}

export async function uploadRecording(opts: {
  callid: string; tenantId: string; telnum?: string | null;
  direction?: string | null; phone?: string | null; durationSeconds?: number | null;
}): Promise<void> {
  const safe = opts.callid.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${DIR}/${safe}.wav`;

  const size = await settled(path);
  if (size === 0) { log(`${opts.callid}: nothing recorded`); return; }

  try {
    const audio = await fs.readFile(path);
    const res = await fetch(`${WEBAPP_URL}/api/voice/recording/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify({
        tenantId: opts.tenantId,
        callid: opts.callid,
        telnum: opts.telnum || null,
        direction: opts.direction || null,
        phone: opts.phone || null,
        durationSeconds: opts.durationSeconds || null,
        audioBase64: audio.toString('base64')
      }),
      signal: AbortSignal.timeout(60000)
    });
    const j: any = await res.json().catch(() => null);
    if (res.ok && j?.ok) {
      log(`${opts.callid}: stored (${Math.round(size / 1024)}KB)`);
      // Removed only once it is safely elsewhere. A failed upload leaves the
      // file behind deliberately: disk is recoverable, a lost recording is not.
      await fs.unlink(path).catch(() => undefined);
    } else {
      log(`${opts.callid}: upload refused — keeping the file`);
    }
  } catch (e: any) {
    log(`${opts.callid}: upload failed (${e?.message || e}) — keeping the file`);
  }
}
