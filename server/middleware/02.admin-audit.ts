// server/middleware/02.admin-audit.ts
// Records every MUTATING admin action (POST/PATCH/PUT/DELETE to /api/admin/*)
// in admin_audit_log, attributed to the acting operator's email + role. This is
// the comprehensive backbone of the audit trail — nothing is missed, because it
// runs for all admin mutations regardless of which endpoint handles them.
// Read-only GETs are not logged (they don't change anything).
import { readAdminSession } from '~/server/utils/session';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

// Map a path to a friendly action key for nicer search/readability.
function actionFor(method: string, path: string): string {
  const p = path.replace(/^\/api\/admin\//, '').replace(/\?.*$/, '');
  const seg = p.split('/')[0] || 'admin';
  const verb = method === 'POST' ? 'update' : method === 'DELETE' ? 'delete' : method === 'PUT' ? 'set' : 'change';
  return `${seg}.${verb}`;
}

export default defineEventHandler(async (event) => {
  const path = event.path || '';
  const method = (event.method || 'GET').toUpperCase();
  if (!path.startsWith('/api/admin/')) return;
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return;
  // Skip the audit-read endpoint itself (it's a GET anyway) and login.
  if (path.startsWith('/api/admin/login') || path.startsWith('/api/admin/logout')) return;

  // Resolve the actor now (session is available pre-handler).
  let actorEmail = 'unknown';
  let actorRole: string | null = null;
  try {
    const s = await readAdminSession(event);
    if (s?.email) {
      actorEmail = s.email;
      const db = useDb();
      const [a] = await db.select().from(schema.platformAdmins)
        .where(eq(schema.platformAdmins.email, s.email)).limit(1);
      actorRole = a?.role ?? null;
    }
  } catch { /* if we can't resolve the actor, still log the attempt */ }

  const ip = getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    || getRequestHeader(event, 'x-real-ip') || null;

  // Write the audit row when the response finishes, so we capture the status.
  event.node.res.once('finish', () => {
    const status = event.node.res.statusCode;
    // Best-effort, fire-and-forget — never block or crash the request.
    Promise.resolve().then(async () => {
      try {
        await useDb().insert(schema.adminAuditLog).values({
          actorEmail,
          actorRole,
          method,
          path: path.replace(/\?.*$/, ''),
          action: actionFor(method, path),
          summary: `${method} ${path.replace(/\?.*$/, '')}`,
          status,
          ip
        });
      } catch { /* swallow — auditing must never break the app */ }
    });
  });
});
