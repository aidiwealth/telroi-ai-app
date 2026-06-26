// control-app/src/provision-agent.ts
// ───────────────────────────────────────────────────────────────────────────
// Authenticated HTTP agent (runs INSIDE the control app, on the PBX box). The
// web app — which cannot touch the PBX directly — calls this to:
//   • provision/deprovision SIP endpoints on Asterisk
//   • originate outbound calls (click-to-call) via ARI
//
// Security: binds to PROVISION_AGENT_BIND (default 127.0.0.1); requires a shared
// bearer secret (PROVISION_AGENT_SECRET), constant-time compared.
// ───────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import crypto from 'node:crypto';
import type Ari from 'ari-client';
import { provisionEndpoint, deprovisionEndpoint } from './provision-core.ts';
import { originateCall } from './originate.ts';

const SECRET = process.env.PROVISION_AGENT_SECRET || '';
const PORT = parseInt(process.env.PROVISION_AGENT_PORT || '8090', 10);
const BIND = process.env.PROVISION_AGENT_BIND || '127.0.0.1';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[provision-agent]', ...args);
}

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
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// `ari` is the connected ARI client, passed from index.ts after connection.
// It may be null if the agent starts before ARI is up (origination will 503).
export function startProvisionAgent(ari: Ari.Client | null = null): http.Server | null {
  if (!SECRET) {
    log('PROVISION_AGENT_SECRET not set — provisioning agent DISABLED.');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

      // POST /provision  { tenantId, label } -> { username, password, domain, ... }
      if (req.method === 'POST' && req.url === '/provision') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || '').trim();
        const label = String(body.label || 'Provisioned device').slice(0, 120);
        if (!tenantId) return send(res, 400, { ok: false, error: 'tenantId required' });
        const result = provisionEndpoint(tenantId, label);
        log(`provisioned ${result.username} for tenant ${tenantId}`);
        return send(res, 200, { ok: true, ...result });
      }

      // POST /deprovision  { username } -> { removed }
      if (req.method === 'POST' && req.url === '/deprovision') {
        const body = await readJson(req);
        const username = String(body.username || '').trim();
        if (!username) return send(res, 400, { ok: false, error: 'username required' });
        const result = deprovisionEndpoint(username);
        log(`deprovisioned ${username} (removed=${result.removed})`);
        return send(res, 200, { ok: true, ...result });
      }

      // POST /originate { agentEndpoint, to, trunk, callerId } -> { callid }
      // Click-to-call: ring the agent's device, then dial the destination out
      // through the named trunk and bridge them.
      if (req.method === 'POST' && req.url === '/originate') {
        if (!ari) return send(res, 503, { ok: false, error: 'ARI not connected' });
        const body = await readJson(req);
        const agentEndpoint = String(body.agentEndpoint || '').trim();
        const to = String(body.to || '').trim();
        const trunk = String(body.trunk || '').trim();
        const callerId = body.callerId ? String(body.callerId).slice(0, 64) : undefined;
        if (!agentEndpoint || !to) {
          return send(res, 400, { ok: false, error: 'agentEndpoint and to are required' });
        }
        try {
          const result = await originateCall({ client: ari, agentEndpoint, to, trunk, callerId });
          log(`originated ${agentEndpoint} -> ${to} via ${trunk} (callid ${result.callid})`);
          return send(res, 200, { ok: true, ...result });
        } catch (e) {
          log(`originate failed: ${(e as Error).message}`);
          return send(res, 502, { ok: false, error: (e as Error).message });
        }
      }

      // GET /health -> liveness (still requires auth)
      if (req.method === 'GET' && req.url === '/health') {
        return send(res, 200, { ok: true, ari: !!ari });
      }

      return send(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      log('error:', (err as Error).message);
      return send(res, 500, { ok: false, error: (err as Error).message });
    }
  });

  server.listen(PORT, BIND, () => {
    log(`listening on ${BIND}:${PORT} (POST /provision, /deprovision, /originate)`);
  });
  return server;
}
