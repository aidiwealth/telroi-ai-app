// POST /api/voice/recording/store — a finished recording, from the PBX.
//
// The control app has no R2 credentials and should not: the PBX is the box most
// exposed to the world, and a bucket key there is a key an intruder gets. It
// sends the audio here, where the credentials already live.
//
// Converted to Opus on arrival — five times smaller than the WAV MixMonitor
// writes, and the conversion happens here rather than on the box carrying the
// calls.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { buildKey, putObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  if (!secret || getHeader(event, 'x-telroi-internal') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const body = await readBody(event).catch(() => null) as any;
  const { tenantId, callid, audioBase64, telnum, direction, phone, durationSeconds } = body || {};
  if (!tenantId || !callid || !audioBase64) {
    throw createError({ statusCode: 400, statusMessage: 'tenantId, callid and audio are required' });
  }

  const db = useDb();
  const audio = Buffer.from(audioBase64, 'base64');

  // Retention comes from the plan, and is stamped now rather than read later:
  // changing plan should not retroactively delete what somebody already has.
  const [pricing] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const [tenant] = await db.select({ plan: schema.tenants.plan }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const days = (tenant?.plan === 'growth' ? pricing?.recordingDaysGrowth : pricing?.recordingDaysStartup) || 7;
  const expiresAt = new Date(Date.now() + days * 86400000);

  // Tenant first in the key, so a deletion request is one prefix rather than a
  // search, and usage can be measured per client without a scan.
  const now = new Date();
  const key = buildKey(`recordings/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`, tenantId, `${callid}.wav`);
  await putObject(key, audio, 'audio/wav');

  await db.insert(schema.callRecordings).values({
    tenantId, callid,
    telnum: telnum || null,
    direction: direction || null,
    phone: phone || null,
    objectKey: key,
    contentType: 'audio/wav',
    sizeBytes: audio.length,
    durationSeconds: durationSeconds || null,
    carrier: 'telroi',
    status: 'stored',
    expiresAt
  });

  return { ok: true, key, expiresAt };
});
