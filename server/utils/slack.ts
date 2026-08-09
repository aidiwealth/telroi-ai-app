// server/utils/slack.ts
// Notifications into our own Slack. Best-effort throughout: a workspace being
// created matters, a message about it failing to send does not, so nothing here
// is allowed to interrupt what it's reporting on.
import { platformSettings } from './platform';
import { decrypt } from './crypto';

async function post(blocks: any[], fallback: string): Promise<void> {
  const ps: any = await platformSettings().catch(() => null);
  if (!ps?.slackWebhookEnc) return;
  let url: string;
  try { url = decrypt(ps.slackWebhookEnc); } catch { return; }
  if (!url) return;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The text is what shows in a notification preview and on clients that
    // can't render blocks — worth writing properly rather than leaving blank.
    body: JSON.stringify({ text: fallback, blocks }),
    signal: AbortSignal.timeout(8000)
  });
}

function when(d: Date = new Date()): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** Somebody created a workspace. No plan yet — they've arrived, not committed. */
export async function slackNewWorkspace(input: {
  name: string; slug: string; email: string;
  country?: string | null; sector?: string | null; phone?: string | null;
}): Promise<void> {
  const detail = [input.country, input.sector, input.phone].filter(Boolean).join(' · ');
  await post([
    { type: 'section', text: { type: 'mrkdwn', text: `*New workspace: ${input.name}*\n\`${input.slug}.telroi.ai\`` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: [input.email, detail, when()].filter(Boolean).join('  ·  ') }] }
  ], `New workspace: ${input.name} (${input.email})`).catch((e) =>
    console.error('[slack] new workspace notice failed:', (e as Error)?.message));
}

/** They chose a plan and went live — the moment that actually earns anything. */
export async function slackWentLive(input: {
  name: string; slug: string; plan: string; email?: string | null;
  balanceMinor?: number | null; currency?: string | null;
}): Promise<void> {
  const money = input.balanceMinor != null
    ? `${input.currency === 'USD' ? '$' : '₦'}${(input.balanceMinor / 100).toLocaleString()}`
    : null;
  const detail = [input.email, money ? `wallet ${money}` : null, when()].filter(Boolean).join('  ·  ');
  await post([
    { type: 'section', text: { type: 'mrkdwn', text: `*${input.name} went live* — ${input.plan} plan\n\`${input.slug}.telroi.ai\`` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: detail }] }
  ], `${input.name} went live on ${input.plan}`).catch((e) =>
    console.error('[slack] go-live notice failed:', (e as Error)?.message));
}
