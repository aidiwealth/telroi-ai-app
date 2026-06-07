// server/routes/_mock/crmapi/v1/[...path].ts
// Local mock of the Telroi CPBX API. Active when TELROI_MOCK_URL points here
// (e.g. http://localhost:3000/_mock/crmapi/v1). Returns shaped fixtures so the
// whole dashboard works without live Digitide credentials.
const NOW = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const FIXTURES: Record<string, any> = {
  'users': {
    items: [
      { login: 'admin', name: 'Administrator', position: 'Administrator', ext: '701', role: 'admin', status: 'online', mobile_redirect: { enabled: false } },
      { login: 'ann', name: 'Ann Smith', position: 'Manager', ext: '702', role: 'user', status: 'online', mobile: '491511904198', mobile_redirect: { enabled: true, forward: false, delay: 15 } },
      { login: 'director', name: 'CEO', position: 'CEO', ext: '703', role: 'admin', status: 'offline', mobile_redirect: { enabled: false } }
    ],
    info: { search: '', start: 0, limit: 3, total: 3 }
  },
  'groups': {
    items: [
      { id: 'sales', name: 'Sales department', ext: '700', call_order: 'BYORDER', call_duration: 10, advanced: 'off', queue_position: false,
        users: [{ login: 'admin', calls_enable: true }, { login: 'ann', calls_enable: true }], timeout: { time: 120, target: 'voicemail' } },
      { id: 'support', name: 'Support', ext: '705', call_order: 'EVENLY', call_duration: 15, advanced: 'callback', queue_position: true,
        users: [{ login: 'ann', calls_enable: true }], timeout: { time: 90, target: 'voicemail' } }
    ],
    info: { search: '', start: 0, limit: 2, total: 2 }
  },
  'telnums': {
    items: [
      { telnum: '491514010121', type: 'group', group: 'sales', group_name: 'Sales department', is_main_phone: true, greeting: false, disabled: false, location: 'Berlin' },
      { telnum: '491512005060', type: 'user', user: 'admin', user_name: 'Administrator', is_main_phone: false, greeting: true, disabled: false, location: '' }
    ],
    info: { search: '', start: 0, limit: 2, total: 2 }
  },
  'blacklist/telnums': [
    { telnum: '490301904198', comment: 'Spam', week: 0, year: 11 },
    { telnum: '4903012345*', comment: 'Robocaller range', week: 2, year: 40 }
  ],
  'domain': {
    timezone: { name: 'Europe/Berlin', offset: 60 },
    limits: { users: { used: 3, total: 15 }, local_gw: { used: 0, total: 1 }, groups: { used: 2, total: 7 } },
    services: { record: true, local_gw: true, branch: false }
  }
};

function mockHistory() {
  const base = Date.now();
  const mk = (i: number, type: string, status: string) => ({
    uid: String(3900000000 + i), type, status,
    client: '49151' + (3800000 + i), diversion: '491514010121',
    user: status === 'missed' ? '' : 'admin', user_name: status === 'missed' ? '' : 'Administrator',
    group_name: 'Sales department', destination: status === 'missed' ? 'group' : 'user',
    start: new Date(base - i * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    wait: (i % 5) + 2, duration: status === 'missed' ? 0 : (i * 13) % 240,
    record: status === 'success' ? 'https://example.com/rec/' + i + '.mp3' : '',
    rating: status === 'success' ? ((i % 5) + 1) : undefined,
    missedStatus: status === 'missed' ? ((i % 4) + 1) : undefined
  });
  const out = [];
  for (let i = 0; i < 24; i++) {
    const r = i % 3;
    out.push(mk(i, r === 2 ? 'out' : 'in', r === 0 ? 'missed' : 'success'));
  }
  return out;
}

export default defineEventHandler(async (event) => {
  const path = (getRouterParam(event, 'path') || '').replace(/\/$/, '');
  const method = event.method;

  // Tenant isolation: the dashboard sends the tenant's domain. Only the seeded
  // demo workspace (acme / mock.local) gets sample data; every real new signup
  // sees an EMPTY account — matching production, where a freshly provisioned PBX
  // has no calls, users or groups yet.
  const domain = (getRequestHeader(event, 'x-telroi-domain') || '').toLowerCase();
  // Only the seeded demo workspace shows sample data. Exact match avoids a real
  // signup that merely contains "acme" inheriting demo content.
  const isDemo = domain === 'mock.local' || domain === 'acme.telroi.ai';

  if (path === 'makecall') return { callid: String(2_000_000_000 + Math.floor(Math.random() * 1e8)), clid: '491512005060' };
  if (path === 'sip-registrations') {
    if (method === 'GET') return isDemo
      ? { items: [{ telnum: '+14155550101', host: 'sip.acmevoice.io', state: 'registered' }], info: { search: '', start: 0, limit: 1, total: 1 } }
      : { items: [], info: { search: '', start: 0, limit: 0, total: 0 } };
    if (method === 'POST') { setResponseStatus(event, 200); return { ok: true, telnum: 'pending', mock: true }; }
  }
  if (path.startsWith('sip-registrations/') && method === 'DELETE') { setResponseStatus(event, 204); return ''; }
  if (path === 'history/json') return isDemo ? mockHistory() : [];
  if (path === 'history/csv') return isDemo ? mockHistory().map((c) => [c.uid, c.status, c.client, c.user, c.diversion, c.start, c.wait, c.duration].join(',')).join('\n') : '';

  if (method === 'GET' && FIXTURES[path]) {
    if (!isDemo) {
      // Empty shapes for a fresh tenant.
      if (path === 'users' || path === 'groups') return { items: [], info: { search: '', start: 0, limit: 0, total: 0 } };
      return Array.isArray(FIXTURES[path]) ? [] : { items: [] };
    }
    return FIXTURES[path];
  }

  // Writes succeed with 204-style empty body.
  if (['POST', 'PUT', 'DELETE'].includes(method)) {
    setResponseStatus(event, path.startsWith('users') || path.startsWith('groups') ? 200 : 204);
    return path.startsWith('users') || path.startsWith('groups') ? { ok: true, mock: true, at: NOW() } : '';
  }

  setResponseStatus(event, 404);
  return { error: { code: 'mock_404', message: `No mock for ${method} /${path}` } };
});
