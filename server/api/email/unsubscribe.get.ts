// GET /api/email/unsubscribe?token=... -> public, no-auth opt-out from
// non-essential (nudge/marketing) emails. Sets emailUnsubscribedAt on the
// tenant matching the token. Returns a small branded confirmation page.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const token = (getQuery(event).token as string || '').trim();
  let ok = false;
  if (token && token !== 'preview') {
    const db = useDb();
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.unsubToken, token)).limit(1);
    if (t) {
      await db.update(schema.tenants).set({ emailUnsubscribedAt: new Date() }).where(eq(schema.tenants.id, t.id));
      ok = true;
    }
  }
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  const msg = ok
    ? 'You\u2019ve been unsubscribed from Telroi tips and reminders. You\u2019ll still receive essential account emails (sign-in codes, receipts, and service notices).'
    : 'We couldn\u2019t process this unsubscribe link. It may have expired — please contact support@telroi.ai.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telroi</title></head>
  <body style="margin:0;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0A0A0B;">
  <div style="max-width:480px;margin:80px auto;background:#fff;border:1px solid #e7e5e0;border-radius:20px;padding:36px;text-align:center;">
    <img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" style="height:26px;margin-bottom:20px;">
    <h1 style="font-family:Fraunces,Georgia,serif;font-weight:400;font-size:22px;margin:0 0 10px;">${ok ? 'Unsubscribed' : 'Hmm'}</h1>
    <p style="color:#5b5b62;font-size:15px;line-height:1.6;margin:0;">${msg}</p>
  </div></body></html>`;
});
