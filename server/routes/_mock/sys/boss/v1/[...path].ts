// Local mock of the Digitide OPERATOR (boss) API, so the /admin console works
// offline. Active when TELROI_MOCK_URL is set (operator client rewrites the
// /crmapi/v1 suffix to /sys/boss/v1).
const DOMAINS = ['acme.digitaltide.io', 'globex.digitaltide.io', 'initech.digitaltide.io'];

function domainInfo(name: string) {
  return {
    name, accessURL: `https://${name}`, billingType: 'demo', extDigits: 3,
    maxLines: 5, accountsLimit: 10, accountsCount: 3, frozen: false,
    language: 'en-US', languageList: ['en-US', 'ru-RU'],
    services: ['autocaller', 'record', 'avm'], allowedCallDirections: ['LOCAL'],
    client: name.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()), ownRegion: 'US',
    sysdomain: false, countSIP: 3
  };
}

export default defineEventHandler(async (event) => {
  const path = (getRouterParam(event, 'path') || '').replace(/\/$/, '');
  const method = event.method;

  if (path === 'domains' && method === 'GET') return DOMAINS;
  if (path === 'generatepassword') return { password: 'Mk$' + Math.random().toString(36).slice(2, 8) };

  const parts = path.split('/');
  // domains/{domain}...
  if (parts[0] === 'domains' && parts[1]) {
    const domain = decodeURIComponent(parts[1]);
    if (parts.length === 2) {
      if (method === 'GET') return domainInfo(domain);
      if (method === 'POST') { setResponseStatus(event, 201); return ''; }       // create
      if (method === 'PUT') return '';
      if (method === 'DELETE') { setResponseStatus(event, 204); return ''; }
    }
    if (parts[2] === 'session') return { link: `https://${domain}/api/login?mock_token=op` };
    if (parts[2] === 'services' && method === 'GET') return domainInfo(domain).services;
    if (parts[2] === 'users' && parts.length === 3 && method === 'GET') {
      return [
        { login: 'admin@' + domain, position: 'Administrator', realName: 'Admin', extension: '701', role: 'admin' },
        { login: 'ann@' + domain, position: 'Manager', realName: 'Ann Smith', extension: '702', role: 'user' }
      ];
    }
    if (parts[2] === 'users' && parts[4] === 'session') return { link: `https://${domain}/login?mock_token=usr` };
    if (parts[2] === 'users') { // create/edit/delete employee
      if (method === 'POST') { setResponseStatus(event, 201); return { login: decodeURIComponent(parts[3] || ''), role: 'user' }; }
      if (method === 'DELETE') { setResponseStatus(event, 204); return ''; }
      return { login: decodeURIComponent(parts[3] || ''), role: 'user' };
    }
  }

  setResponseStatus(event, 404);
  return { error: { code: 'mock_404', message: `No boss mock for ${method} /${path}` } };
});
