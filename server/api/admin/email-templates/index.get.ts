// GET /api/admin/email-templates -> the editable email catalog: each template's
// key, label, the fields an admin may override, current override values, and the
// shared social-link settings used in the footer.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export const EMAIL_TEMPLATES = [
  { key: 'welcome', label: 'Welcome', desc: 'Sent when a new workspace is created. Greeting + setup checklist.' },
  { key: 'otp', label: 'Sign-in code (OTP)', desc: 'The login code / magic link email.' },
  { key: 'numberActivated', label: 'Number activated', desc: 'Sent when a client\u2019s number goes live.' },
  { key: 'complianceApproved', label: 'Compliance approved', desc: 'Sent when submitted documents are approved.' },
  { key: 'followup48', label: 'Follow-up · 48 hours', desc: 'Nudge after 48h of no activity.' },
  { key: 'followup1w', label: 'Follow-up · 1 week', desc: 'Nudge after 1 week of no activity.' }
];

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).limit(1);
  return {
    templates: EMAIL_TEMPLATES,
    overrides: (s?.emailOverrides as any) || {},
    social: (s?.emailSocial as any) || {}
  };
});
