// POST /api/cron/auto-topup  (header: x-cron-secret)
// Bounded exclusive dispatch and GET-only recovery batches.
import { executeAutoTopups } from '~/server/utils/auto-topup-executor';

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  if (secret) {
    if (given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });
  } else {
    const { requirePlatformAdmin } = await import('~/server/utils/platform');
    await requirePlatformAdmin(event);
  }

  const execution = await executeAutoTopups();
  return { ok: true, execution };
});
