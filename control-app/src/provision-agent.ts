// control-app/src/provision-agent.ts
// ───────────────────────────────────────────────────────────────────────────
// Authenticated HTTP provisioning agent (runs INSIDE the control app, on the
// PBX box). The web app — which cannot touch the PBX directly — calls this to
// provision/deprovision SIP endpoints on Asterisk.
//
// Security:
//   • Binds to PROVISION_AGENT_BIND (default 127.0.0.1) so by default it's only
//     reachable locally. To let the cloud web app reach it, bind to 0.0.0.0 AND
//     restrict the port at the firewall to the web app's egress IP(s), OR front
//     it with a TLS reverse proxy. Never expose it openly.
//   • Requires a shared secret in the Authorization header (Bearer <secret>),
//     compared in constant time. Set PROVISION_AGENT_SECRET (long random).
//   • Only provisions/deprovisions — no other operations.
//
// The agent does NOT write the sip_endpoints DB row; it returns the credentials
// and the web app persists them with its own encrypt(). Single responsibility:
// make Asterisk serve / stop serving an endpoint.
// ───────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import crypto from 'node:crypto';
import { provisionEndpoint, deprovisionEndpoint } from './provision-core.ts';

const SECRET = process.env.PROVISION_AGENT_SECRET || '';
const PORT = parseInt(process.env.PROVISION_AGENT_PORT || '8090', 10);
const BIND = process.env.PROVISION_AGENT_BIND || '127.0.0.1';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[provision-agent]', ...args);
}

// Constant-time bearer-token check.
function authOk(req: http.IncomingMessage): boolean {
  if (!SECRET) return false;
  const hdr = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/.exec(Array.isArray(hdr) ? hdr[0] : hdr);
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const expected = Buffer.from(SECRET);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function send(res: http.ServerResponse, code: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export function startProvisionAgent(): http.Server | null {
  if (!SECRET) {
    log('PROVISION_AGENT_SECRET not set — provisioning agent DISABLED.');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

      // POST /provision  { tenantId, label }  -> { username, password, domain, ... }
      if (req.method === 'POST' && req.url === '/provision') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || '').trim();
        const label = String(body.label || 'Provisioned device').slice(0, 120);
        if (!tenantId) return send(res, 400, { ok: false, error: 'tenantId required' });
        const result = provisionEndpoint(tenantId, label);
        log(`provisioned ${result.username} for tenant ${tenantId}`);
        return send(res, 200, { ok: true, ...result });
      }

      // POST /deprovision  { username }  -> { removed }
      if (req.method === 'POST' && req.url === '/deprovision') {
        const body = await readJson(req);
        const username = String(body.username || '').trim();
        if (!username) return send(res, 400, { ok: false, error: 'username required' });
        const result = deprovisionEndpoint(username);
        log(`deprovisioned ${username} (removed=${result.removed})`);
        return send(res, 200, { ok: true, ...result });
      }

      // GET /health -> liveness (still requires auth)
      if (req.method === 'GET' && req.url === '/health') {
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      log('error:', (err as Error).message);
      return send(res, 500, { ok: false, error: (err as Error).message });
    }
  });

  server.listen(PORT, BIND, () => {
    log(`listening on ${BIND}:${PORT} (POST /provision, /deprovision)`);
  });
  return server;
}
