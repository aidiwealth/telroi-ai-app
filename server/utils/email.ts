// server/utils/email.ts
// Provider-agnostic email. 'console' (logs to stdout) for dev; 'resend' for
// full HTML email; 'termii' for OTP delivery via Termii's email-token API.
//
// Termii note: its email-OTP endpoint ONLY delivers a numeric code (it can't
// carry magic links, invites, or the policy document, and it does NOT verify
// the code — we generate and verify OTPs ourselves). So when the provider is
// 'termii' we send the OTP through Termii; any non-OTP email (invites, policy)
// falls back to Resend if configured, otherwise the console.

interface SendArgs { to: string; subject: string; html: string; text: string; otp?: string; }

async function sendViaTermii(to: string, otp: string): Promise<boolean> {
  const cfg = useRuntimeConfig() as any;
  const base = (cfg.termiiBaseUrl || 'https://api.ng.termii.com').replace(/\/$/, '');
  if (!cfg.termiiApiKey || !cfg.termiiEmailConfigId) return false;
  try {
    const res = await $fetch<any>(`${base}/api/email/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        api_key: cfg.termiiApiKey,
        email_address: to,
        code: otp,
        email_configuration_id: cfg.termiiEmailConfigId
      }
    });
    // Termii returns { code: 'ok', message: 'Successfully Sent', ... } on success.
    if (res && (res.code === 'ok' || /sent/i.test(res.message || ''))) return true;
    console.error('[email/termii] unexpected response', res);
    return false;
  } catch (e: any) {
    console.error('[email/termii] send failed', e?.data || e?.message || e);
    return false;
  }
}


// Provider-agnostic email logging: logs EVERY send attempt (success and failure)
// for all providers (Resend, Termii, console) and all email types.
async function sendVia(args: SendArgs) {
  try {
    await sendViaImpl(args);
    console.log("[email] sent", { to: args.to, subject: args.subject, otp: !!args.otp });
  } catch (e: any) {
    console.error("[email] send FAILED", { to: args.to, subject: args.subject, otp: !!args.otp, error: e?.message || e });
    throw e;
  }
}

async function sendViaImpl(args: SendArgs) {
  // Preview capture: when rendering a template for the admin UI, intercept the
  // payload instead of delivering it.
  if (__captureMode) { __capture = { subject: args.subject, html: args.html }; return; }
  const cfg = useRuntimeConfig() as any;

  // OTP routing is operator-controlled. Resolve the channel from platform
  // settings (admin toggle); an explicit EMAIL_PROVIDER=termii env var also
  // forces Termii. Default is Resend for everything.
  if (args.otp) {
    let otpChannel = 'resend';
    try {
      const { platformSettings } = await import('./platform');
      const s = await platformSettings();
      otpChannel = (s?.otpChannel as string) || 'resend';
    } catch { /* settings unavailable — fall back to resend */ }
    if (cfg.emailProvider === 'termii') otpChannel = 'termii'; // env override

    if (otpChannel === 'termii') {
      const ok = await sendViaTermii(args.to, args.otp);
      if (ok) return;
      // Termii failed — fall through to the base sender so the user still
      // receives their code.
      console.warn('[email] Termii OTP send failed; falling back to base sender');
    }
  }

  // Base sender for all email (OTP fallback + every non-OTP message).
  if (cfg.resendApiKey && cfg.emailProvider !== 'console') {
    const { Resend } = await import('resend');
    const resend = new Resend(cfg.resendApiKey);
    const __r = await resend.emails.send({ from: cfg.emailFrom, to: args.to, subject: args.subject, html: args.html, text: args.text });
    if ((__r as any)?.error) console.error("[email/resend] rejected", { to: args.to, from: cfg.emailFrom, error: (__r as any).error });
    else console.log("[email/resend] accepted", { to: args.to, id: (__r as any)?.data?.id });
    return;
  }
  // console fallback — visible in dev (or when no Resend key is set yet)
  console.log(`\n──────── EMAIL (${args.to}) ────────\n${args.subject}\n${args.text}\n────────────────────────────────\n`);
}

// Brand-themed email shell. Email clients require inline styles + table layout
// for reliable rendering, so this mirrors the site theme (Fraunces display,
// Geist body, signal blue, cream paper) using email-safe markup.
const BRAND = {
  ink: '#0A0A0B', inkSoft: '#5b5b62', inkMute: '#8b8b93',
  paper: '#ffffff', paper2: '#f7f6f3', rule: '#e7e5e0',
  signal: '#1a4b72', signal2: '#123857', signalSoft: '#e7eef4',
  logo: 'https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png'
};

function socialIcons(social?: { x?: string; linkedin?: string; instagram?: string; facebook?: string }) {
  if (!social) return '';
  const items: string[] = [];
  const icon = (href: string, svg: string) => `<a href="${href}" style="display:inline-block;margin:0 6px;text-decoration:none;">${svg}</a>`;
  // Simple monochrome glyphs (inline SVG renders in most modern clients; falls
  // back to nothing in the few that strip SVG).
  if (social.x) items.push(icon(social.x, `<img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/social-x.png" alt="X" width="18" height="18" style="width:18px;height:18px;vertical-align:middle;">`));
  if (social.linkedin) items.push(icon(social.linkedin, `<img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/social-linkedin.png" alt="LinkedIn" width="18" height="18" style="width:18px;height:18px;vertical-align:middle;">`));
  if (social.instagram) items.push(icon(social.instagram, `<img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/social-instagram.png" alt="Instagram" width="18" height="18" style="width:18px;height:18px;vertical-align:middle;">`));
  if (social.facebook) items.push(icon(social.facebook, `<img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/social-facebook.png" alt="Facebook" width="18" height="18" style="width:18px;height:18px;vertical-align:middle;">`));
  if (!items.length) return '';
  return `<div style="margin:0 0 10px;">${items.join('')}</div>`;
}

function shell(inner: string, opts: { preheader?: string; unsubUrl?: string; social?: any } = {}) {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>`
    : '';
  const unsub = opts.unsubUrl
    ? `&nbsp;·&nbsp; <a href="${opts.unsubUrl}" style="color:${BRAND.inkMute};text-decoration:underline;">Unsubscribe</a>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${BRAND.paper2};font-family:Geist,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:${BRAND.ink};-webkit-font-smoothing:antialiased;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper2};padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:${BRAND.paper};border:1px solid ${BRAND.rule};border-radius:20px;overflow:hidden;">
      <tr><td style="padding:26px 36px 0;">
        <img src="${BRAND.logo}" alt="Telroi" height="26" style="height:26px;display:block;">
      </td></tr>
      <tr><td style="padding:24px 36px 34px;">${inner}</td></tr>
      <tr><td style="padding:20px 36px;border-top:1px solid ${BRAND.rule};background:${BRAND.paper2};">
        ${socialIcons(opts.social)}
        <p style="margin:0 0 4px;color:${BRAND.inkSoft};font-size:12.5px;line-height:1.5;">AI-native voice infrastructure</p>
        <p style="margin:0;color:${BRAND.inkMute};font-size:12px;line-height:1.6;">
          <a href="https://telroi.ai" style="color:${BRAND.signal};text-decoration:none;">telroi.ai</a>
          &nbsp;·&nbsp; <a href="mailto:support@telroi.ai" style="color:${BRAND.signal};text-decoration:none;">support@telroi.ai</a>${unsub}
        </p>
      </td></tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;color:${BRAND.inkMute};font-size:11px;line-height:1.5;text-align:center;">
      You're receiving this because you have a Telroi account. © Telroi
    </p>
  </td></tr>
</table>
</body></html>`;
}

// Small reusable building blocks (inline-styled) for consistent emails.
function h1(text: string) {
  return `<h1 style="font-family:Fraunces,Georgia,'Times New Roman',serif;font-weight:400;font-size:27px;line-height:1.2;letter-spacing:-0.02em;margin:0 0 10px;color:${BRAND.ink};">${text}</h1>`;
}
function para(text: string) {
  return `<p style="color:${BRAND.inkSoft};font-size:15px;line-height:1.6;margin:0 0 18px;">${text}</p>`;
}
function button(label: string, href: string, dark = false) {
  const bg = dark ? BRAND.ink : BRAND.signal;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;"><tr><td style="border-radius:999px;background:${bg};">
    <a href="${href}" style="display:inline-block;padding:13px 26px;color:#fff;text-decoration:none;font-size:14px;font-weight:500;">${label}</a>
  </td></tr></table>`;
}
function divider() {
  return `<hr style="border:none;border-top:1px solid ${BRAND.rule};margin:22px 0;">`;
}

export async function sendLoginEmail(to: string, magicLink: string, otp: string) {
  const subject = 'Your Telroi sign-in code';
  const text = `Sign in to Telroi.\n\nMagic link: ${magicLink}\n\nOr enter this code: ${otp}\n\nThis expires in 10 minutes. If you didn't request it, ignore this email.`;
  const html = shell(`
    ${h1('Sign in to Telroi')}
    ${para('Tap the button to sign in instantly, or enter the code below on the sign-in screen. Both expire in 10 minutes.')}
    ${button('Sign in to Telroi →', magicLink)}
    <p style="color:${BRAND.inkMute};font-size:13px;margin:24px 0 10px;">Or enter this code:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px;"><tr><td style="background:${BRAND.signalSoft};border:1px solid ${BRAND.rule};border-radius:12px;padding:16px 26px;">
      <span style="font-family:Geist,monospace;font-size:32px;letter-spacing:0.32em;font-weight:600;color:${BRAND.signal2};">${otp}</span>
    </td></tr></table>
    ${divider()}
    <p style="color:${BRAND.inkMute};font-size:12.5px;line-height:1.5;margin:0;">If you didn't try to sign in, you can safely ignore this email — no one can access your account without this code.</p>
  `, { preheader: `Your Telroi code is ${otp}` });
  await sendVia({ to, subject, html, text, otp });
}

export async function sendInviteEmail(to: string, workspace: string, link: string) {
  const subject = `You've been invited to ${workspace} on Telroi`;
  const text = `You've been invited to join ${workspace} on Telroi.\n\nAccept: ${link}`;
  const html = shell(`
    ${h1(`Join ${workspace}`)}
    ${para(`You've been invited to the <strong>${workspace}</strong> team on Telroi. Sign in with your email to get started — no password needed.`)}
    ${button('Accept invite →', link, true)}
  `, { preheader: `Join the ${workspace} team on Telroi` });
  await sendVia({ to, subject, html, text });
}

export async function sendPolicyEmail(to: string, workspace: string) {
  const { POLICY_TITLE, POLICY_VERSION, policyHtml, POLICY_SECTIONS } = await import('./policy');
  const subject = `Your Telroi agreement — ${POLICY_TITLE}`;
  const text = `Thank you for creating ${workspace} on Telroi.\n\nYou accepted the ${POLICY_TITLE} (version ${POLICY_VERSION}). A copy is included for your records.\n\n` +
    POLICY_SECTIONS.map((s) => `${s.heading}\n${s.body.join('\n')}`).join('\n\n');
  const html = shell(`
    ${h1('Your agreement')}
    ${para(`Thanks for creating <strong>${workspace}</strong> on Telroi. You accepted the following on version ${POLICY_VERSION}. Keep this copy for your records.`)}
    ${divider()}
    ${policyHtml()}
  `, { preheader: `Your copy of the ${POLICY_TITLE}` });
  await sendVia({ to, subject, html, text });
}

// ── Welcome email: warm note from the team + a short guided checklist of the
// steps to finish setting up the account. Sent after a workspace is created.
export async function sendWelcomeEmail(to: string, opts: { workspace: string; name?: string | null } = { workspace: 'your workspace' }) {
  const appBase = (useRuntimeConfig().public as any).appBaseUrl || 'https://app.telroi.ai';
  const first = (opts.name || '').split(' ')[0];
  const greeting = first ? `Welcome, ${first}` : 'Welcome to Telroi';
  const subject = `Welcome to Telroi — let's get ${opts.workspace} set up`;

  const steps = [
    { n: '1', title: 'Add a payment method', desc: 'Save a card so your wallet can stay topped up and your service never pauses.', to: '/wallet' },
    { n: '2', title: 'Get a phone number', desc: 'Pick a business number so customers can reach you.', to: '/numbers' },
    { n: '3', title: 'Connect an AI provider', desc: 'Link an AI key to power your Virtual AI Numbers and agents.', to: '/ai' },
    { n: '4', title: 'Create your first AI Number', desc: 'Bind a number to an AI agent so calls are handled automatically.', to: '/vans' }
  ];
  const stepRows = steps.map((s) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;"><tr>
      <td width="34" valign="top">
        <div style="width:26px;height:26px;border-radius:999px;background:${BRAND.signalSoft};color:${BRAND.signal};font-size:13px;font-weight:600;text-align:center;line-height:26px;">${s.n}</div>
      </td>
      <td valign="top" style="padding-bottom:2px;">
        <a href="${appBase}${s.to}" style="color:${BRAND.ink};font-size:14.5px;font-weight:600;text-decoration:none;">${s.title} →</a>
        <p style="margin:2px 0 0;color:${BRAND.inkSoft};font-size:13px;line-height:1.5;">${s.desc}</p>
      </td>
    </tr></table>`).join('');

  const text = `${greeting}!\n\nWe're glad you're here. ${opts.workspace} is ready — here's how to finish setting up:\n\n` +
    steps.map((s) => `${s.n}. ${s.title} — ${s.desc} (${appBase}${s.to})`).join('\n') +
    `\n\nIf you get stuck, just reply or email support@telroi.ai. We're a quick message away.\n\n— The Telroi team`;

  const html = shell(`
    ${h1(greeting)}
    ${para(`We're genuinely glad you're here. <strong>${opts.workspace}</strong> is ready to go — here are the few steps to get your voice line live. It takes just a few minutes.`)}
    <div style="background:${BRAND.paper2};border:1px solid ${BRAND.rule};border-radius:14px;padding:20px 20px 12px;margin:0 0 20px;">
      ${stepRows}
    </div>
    ${button('Open your dashboard →', appBase + '/')}
    ${divider()}
    <p style="color:${BRAND.inkSoft};font-size:14px;line-height:1.6;margin:0;">A quick note from us: Telroi was built to make voice + AI genuinely simple for teams like yours. If anything's unclear or you'd like a hand getting started, just reply to this email or reach <a href="mailto:support@telroi.ai" style="color:${BRAND.signal};">support@telroi.ai</a> — a real person will help.</p>
    <p style="color:${BRAND.ink};font-size:14px;margin:16px 0 0;">— The Telroi team</p>
  `, { preheader: `${opts.workspace} is ready — a few quick steps to go live.` });

  await sendVia({ to, subject, html, text });
}

// ── Number activated: a client's number is live and ready to take calls.
export async function sendNumberActivatedEmail(to: string, opts: { workspace: string; telnum: string }) {
  const appBase = (useRuntimeConfig().public as any).appBaseUrl || 'https://app.telroi.ai';
  const subject = `Your number ${opts.telnum} is live on Telroi`;
  const text = `Good news — your number ${opts.telnum} is now active on Telroi and ready to take calls.\n\nManage it: ${appBase}/numbers`;
  const html = shell(`
    ${h1('Your number is live')}
    ${para(`Good news — your number is active on <strong>${opts.workspace}</strong> and ready to make and receive calls through your AI routing.`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:${BRAND.signalSoft};border:1px solid ${BRAND.rule};border-radius:12px;padding:14px 22px;">
      <span style="font-family:Geist,monospace;font-size:22px;font-weight:600;letter-spacing:0.02em;color:${BRAND.signal2};">${opts.telnum}</span>
      <span style="display:inline-block;margin-left:10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#0a8a5c;background:rgba(0,210,138,0.12);padding:3px 9px;border-radius:999px;">Active</span>
    </td></tr></table>
    ${button('Manage your numbers →', appBase + '/numbers')}
  `, { preheader: `${opts.telnum} is now active and ready for calls.` });
  await sendVia({ to, subject, html, text });
}

// ── Compliance approved: the client's submitted documents passed review.
export async function sendComplianceApprovedEmail(to: string, opts: { workspace: string }) {
  const appBase = (useRuntimeConfig().public as any).appBaseUrl || 'https://app.telroi.ai';
  const subject = 'Approved — you can now take your workspace live';
  const text = `Your compliance documents for ${opts.workspace} have been reviewed and approved.\n\nOne step left: choose your plan to take the workspace live. Until then it stays in sandbox, with limited test calls and no charges.\n\n${appBase}/settings`;
  const html = shell(`
    ${h1('You&rsquo;re approved')}
    ${para(`The documents you submitted for <strong>${opts.workspace}</strong> have been reviewed and <strong>approved</strong>.`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:rgba(0,210,138,0.10);border:1px solid rgba(0,210,138,0.3);border-radius:12px;padding:13px 20px;">
      <span style="font-size:13.5px;font-weight:600;color:#0a8a5c;">✓ Compliance approved</span>
    </td></tr></table>
    ${para(`One step left: <strong>choose your plan</strong> to take the workspace live. Until you do, it stays in sandbox — limited test calls, and nothing is charged.`)}
    ${button('Choose your plan →', appBase + '/settings')}
  `, { preheader: `${opts.workspace} is approved — choose a plan to go live.` });
  await sendVia({ to, subject, html, text });
}

// ── Admin-editable content + footer context ───────────────────────────────
// Loads override copy + social links once, and builds an unsubscribe URL for a
// given tenant. Overrides let operators tweak subject/heading/intro per email.
async function emailContext(tenantUnsubToken?: string) {
  let overrides: Record<string, any> = {};
  let social: any = {};
  let appBase = (useRuntimeConfig().public as any).appBaseUrl || 'https://app.telroi.ai';
  try {
    const { platformSettings } = await import('./platform');
    const s = await platformSettings();
    overrides = (s?.emailOverrides as any) || {};
    social = (s?.emailSocial as any) || {};
  } catch { /* settings unavailable */ }
  const unsubUrl = tenantUnsubToken ? `${appBase}/api/email/unsubscribe?token=${encodeURIComponent(tenantUnsubToken)}` : undefined;
  return { overrides, social, appBase, unsubUrl };
}
function ov(overrides: Record<string, any>, key: string, field: string, fallback: string) {
  return (overrides?.[key]?.[field] as string) || fallback;
}

// ── Inactivity follow-ups ──────────────────────────────────────────────────
// Sent by the cron runner when a workspace has done nothing since signup.
// Both nudge toward a first real action (buy a number / top up the wallet).
export async function sendFollowup48Email(to: string, opts: { workspace: string; name?: string | null; unsubToken?: string }) {
  const { overrides, social, appBase, unsubUrl } = await emailContext(opts.unsubToken);
  const first = (opts.name || '').split(' ')[0];
  const subject = ov(overrides, 'followup48', 'subject', `Ready to make your first call on Telroi?`);
  const heading = ov(overrides, 'followup48', 'heading', first ? `Still there, ${first}?` : 'Ready when you are');
  const intro = ov(overrides, 'followup48', 'intro', `Your workspace <strong>${opts.workspace}</strong> is set up, but you haven't taken it for a spin yet. You're two minutes away from a live AI-powered number.`);
  const body = ov(overrides, 'followup48', 'body', 'The quickest way to start: get a business number, or top up your wallet so calls can connect.');
  const text = `${heading}\n\n${opts.workspace} is set up but inactive. Get a number or top up your wallet to start: ${appBase}/numbers`;
  const html = shell(`
    ${h1(heading)}
    ${para(intro)}
    ${para(body)}
    ${button('Get a number →', appBase + '/numbers')}
    <p style="color:${BRAND.inkMute};font-size:13px;margin:14px 0 0;">Prefer to fund first? <a href="${appBase}/wallet" style="color:${BRAND.signal};">Top up your wallet →</a></p>
  `, { preheader: 'You\u2019re two minutes from your first live number.', unsubUrl, social });
  await sendVia({ to, subject, html, text });
}

export async function sendFollowup1wEmail(to: string, opts: { workspace: string; name?: string | null; unsubToken?: string }) {
  const { overrides, social, appBase, unsubUrl } = await emailContext(opts.unsubToken);
  const first = (opts.name || '').split(' ')[0];
  const subject = ov(overrides, 'followup1w', 'subject', 'Can we help you get started on Telroi?');
  const heading = ov(overrides, 'followup1w', 'heading', 'A hand getting started?');
  const intro = ov(overrides, 'followup1w', 'intro', `It's been a week and <strong>${opts.workspace}</strong> hasn't gone live yet. If something got in the way, we'd genuinely like to help.`);
  const body = ov(overrides, 'followup1w', 'body', 'Reply to this email or reach support@telroi.ai and a real person will walk you through buying a number, funding your wallet, and taking your first AI call.');
  const text = `${heading}\n\n${intro}\n\n${body}\n\nStart now: ${appBase}/numbers  ·  support@telroi.ai`;
  const html = shell(`
    ${h1(heading)}
    ${para(intro)}
    ${para(body)}
    ${button('Set up my first number →', appBase + '/numbers')}
    <p style="color:${BRAND.inkSoft};font-size:14px;margin:16px 0 0;">— The Telroi team</p>
  `, { preheader: 'We\u2019d like to help you go live.', unsubUrl, social });
  await sendVia({ to, subject, html, text });
}

// ── Preview renderer (for admin Settings → Emails) ─────────────────────────
// Returns the rendered HTML + subject for a given template key using sample
// data, so admins see exactly how an email looks (with their overrides applied).
export async function renderEmailPreview(key: string): Promise<{ subject: string; html: string }> {
  const sample = { to: 'sample@client.com', workspace: 'Acme Inc', name: 'Ada Lovelace', telnum: '+1 415 555 0142', otp: '042195', unsubToken: 'preview' };
  const { appBase } = await emailContext('preview');
  switch (key) {
    case 'welcome': return capture(() => sendWelcomeEmail(sample.to, { workspace: sample.workspace, name: sample.name }));
    case 'otp': return capture(() => sendLoginEmail(sample.to, `${appBase}/api/auth/magic?token=preview`, sample.otp));
    case 'numberActivated': return capture(() => sendNumberActivatedEmail(sample.to, { workspace: sample.workspace, telnum: sample.telnum }));
    case 'complianceApproved': return capture(() => sendComplianceApprovedEmail(sample.to, { workspace: sample.workspace }));
    case 'followup48': return capture(() => sendFollowup48Email(sample.to, sample));
    case 'followup1w': return capture(() => sendFollowup1wEmail(sample.to, sample));
    default: return { subject: '(unknown template)', html: '<p>Unknown template</p>' };
  }
}
// capture: run a send function but intercept the payload instead of delivering.
let __captureMode = false;
let __capture: { subject: string; html: string } | null = null;
async function capture(fn: () => Promise<void>): Promise<{ subject: string; html: string }> {
  __capture = { subject: '', html: '' };
  __captureMode = true;
  try { await fn(); } finally { __captureMode = false; }
  const r = __capture; __capture = null;
  return r || { subject: '', html: '' };
}
