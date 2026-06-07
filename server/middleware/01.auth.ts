// Guards /api/** (except auth + public webhooks). Attaches session to context.
import { readSession } from '~/server/utils/session';

const PUBLIC_PREFIXES = ['/api/auth/', '/api/webhooks/'];
export default defineEventHandler(async (event) => {
  const path = event.path || '';
  if (!path.startsWith('/api/')) return;
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return;
  event.context.session = await readSession(event);
});
