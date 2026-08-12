// POST /api/admin/settings/slack-test -> post a message to the configured
// channel, so a wrong URL is discovered here rather than at a signup that never
// announced itself.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const { platformSettings } = await import('~/server/utils/platform');
  const ps: any = await platformSettings();

  // Each channel testable on its own. A payments webhook that fails silently is
  // the one you would least want to discover from an absence.
  const body = await readBody(event).catch(() => ({} as any));
  const channel = body?.channel === 'payments' ? 'payments' : 'general';
  const enc = channel === 'payments' ? ps?.slackPaymentsEnc : ps?.slackWebhookEnc;
  if (!enc) throw apiError('not_configured', `No ${channel === 'payments' ? 'payments' : 'Slack'} webhook is saved yet`, 400);

  const { decrypt } = await import('~/server/utils/crypto');
  const url = decrypt(enc);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: channel === 'payments'
      ? 'Telroi is connected. Payments will appear here.'
      : 'Telroi is connected. New workspaces, go-lives and SIP requests will appear here.' }),
    signal: AbortSignal.timeout(8000)
  }).catch((e) => { throw apiError('send_failed', e?.message || 'Could not reach Slack', 502); });

  if (!res.ok) throw apiError('send_failed', `Slack refused it (${res.status}) — the URL may be wrong or the channel deleted`, 502);
  return { ok: true };
});
