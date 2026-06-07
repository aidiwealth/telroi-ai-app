// Friendly-hostname rewrites for the public docs and status pages. If a request
// arrives on the operator-configured docs subdomain (platformSettings.docsDomain,
// e.g. developers.telroi.ai) it's served the API docs; on the status subdomain
// (statusDomain, e.g. status.telroi.ai) it's served the status page. Both pages
// also always live at their default paths (/api/docs, /status), so this is purely
// a hostname convenience. Runs before auth (filename sorts first).
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

let cached: { docs: string | null; status: string | null; at: number } = { docs: null, status: null, at: 0 };

export default defineEventHandler(async (event) => {
  const host = (getRequestHeader(event, 'host') || '').split(':')[0].toLowerCase();
  if (!host) return;
  const path = event.path || '/';
  if (path.startsWith('/api/') || path.startsWith('/_nuxt') || path.startsWith('/v1/')) return;

  if (Date.now() - cached.at > 60000) {
    try {
      const db = useDb();
      const [s] = await db.select({ d: schema.platformSettings.docsDomain, st: schema.platformSettings.statusDomain })
        .from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
      cached = { docs: s?.d || null, status: s?.st || null, at: Date.now() };
    } catch { cached = { ...cached, at: Date.now() }; }
  }

  if (cached.docs && host === cached.docs) {
    if (path === '/' || !path.startsWith('/api/docs')) event.node.req.url = '/api/docs';
    return;
  }
  if (cached.status && host === cached.status) {
    if (path === '/' || !path.startsWith('/status')) event.node.req.url = '/status';
  }
});
