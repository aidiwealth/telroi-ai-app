// POST /api/admin/verify-otp { email, code } -> issues a SEPARATE admin session
// cookie (telroi_admin_session). Only succeeds if the email is a platform admin.
// Keeps the client session cookie untouched, so an operator can be signed into
// both the admin console and a client workspace simultaneously.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { verifyOtp } from '~/server/utils/auth-core';
import { issueAdminSession } from '~/server/utils/session';
import { apiError, rateLimit, clientIp } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Email and 6-digit code required');
  rateLimit('admin_otp_ip', clientIp(event), 30, 15 * 60 * 1000);
  rateLimit('admin_otp_email', parsed.data.email.toLowerCase().trim(), 10, 15 * 60 * 1000);

  const email = await verifyOtp(parsed.data.email, parsed.data.code);

  // Must be a registered platform admin.
  const db = useDb();
  const [admin] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)).limit(1);
  if (!admin) throw apiError('forbidden', 'This account does not have operator access.', 403);

  await issueAdminSession(event, { email: admin.email, role: admin.role });
  return { ok: true, role: admin.role };
});
