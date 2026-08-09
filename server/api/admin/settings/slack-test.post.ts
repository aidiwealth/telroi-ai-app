// POST /api/admin/settings/slack-test -> post a message to the configured
// channel, so a wrong URL is discovered here rather than at a signup that never
// announced itself.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const { platformSettings } = await import('~/server/utils/platform');
  const ps: any = await platformSettings();
  if (!ps?.slackWebhookEnc) throw apiError('not_configured', 'No Slack webhook is saved yet', 400);

  const { decrypt } = await import('~/server/utils/crypto');
  const url = decrypt(ps.slackWebhookEnc);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Telroi is connected. New workspaces and go-lives will appear here.' }),
    signal: AbortSignal.timeout(8000)
  }).catch((e) => { throw apiError('send_failed', e?.message || 'Could not reach Slack', 502); });

  if (!res.ok) throw apiError('send_failed', `Slack refused it (${res.status}) — the URL may be wrong or the channel deleted`, 502);
  return { ok: true };
});
