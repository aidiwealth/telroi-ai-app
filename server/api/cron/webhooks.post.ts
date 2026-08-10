// POST /api/cron/webhooks  (header: x-cron-secret)
// Sends queued client webhooks. Wanted every minute or two rather than daily —
// a call event arriving an hour late is no use to anybody — so it is its own
// endpoint rather than riding the billing job.
//
// Bounded per run: a backlog must not monopolise an instance that also has
// calls to route.
export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  if (secret) {
    if (given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });
  } else {
    const { requirePlatformAdmin } = await import('~/server/utils/platform');
    await requirePlatformAdmin(event);
  }

  const { dispatchWebhooks } = await import('~/server/utils/webhooks-out');
  const result = await dispatchWebhooks();
  return { ok: true, ...result };
});
