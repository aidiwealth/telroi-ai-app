// server/utils/telroi/operator.ts
// Typed client for the Digitide OPERATOR (boss) REST API.
// Base: https://{operator-domain}/sys/boss/v1/{endpoint}   Auth: X-API-KEY
//
// This is the master/platform credential. It manages client DOMAINS, employees
// across them, phone-number assignment, and — crucially — minting login-session
// links so employees never need a Digitide password.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import { decrypt } from '../crypto';

export interface OperatorCreds { domain: string; apiKey: string; username?: string; password?: string }

export class OperatorClient {
  private base: string;
  private apiKey: string;
  private username?: string;
  private password?: string;

  constructor(creds: OperatorCreds) {
    const mock = useRuntimeConfig().telroiMockUrl;
    // In mock mode, reuse the local mock under a boss path.
    this.base = mock ? mock.replace('/crmapi/v1', '/sys/boss/v1') : `https://${creds.domain}/sys/boss/v1`;
    this.apiKey = creds.apiKey;
    this.username = creds.username;
    this.password = creds.password;
  }

  /** Build from the single platform_settings row. Throws if not configured. */
  static async fromPlatform() {
    const db = useDb();
    const [s] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
    if (!s?.operatorDomain || !s?.operatorApiKeyEnc) {
      throw createError({ statusCode: 409, message: 'Operator API not configured' });
    }
    return new OperatorClient({
      domain: s.operatorDomain,
      apiKey: decrypt(s.operatorApiKeyEnc),
      username: s.operatorUsername || undefined,
      password: s.operatorPasswordEnc ? decrypt(s.operatorPasswordEnc) : undefined
    });
  }

  private async req<T>(method: string, path: string, opts: { body?: any } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (this.username && this.password) {
      const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res: Response;
    try {
      res = await fetch(this.base.replace(/\/$/, '') + path, {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal
      });
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      throw createError({
        statusCode: 504,
        data: { error: { code: aborted ? 'operator_timeout' : 'operator_unreachable', message: aborted ? 'Operator API did not respond within 20s' : `Operator API unreachable: ${e?.message || 'connection failed'}` } },
        message: aborted ? 'Operator API timed out (20s)' : `Operator API unreachable: ${e?.message || 'connection failed'}`
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail: any = null;
      try { detail = await res.json(); } catch { /* */ }
      throw createError({
        statusCode: res.status,
        data: { error: { code: `operator_${res.status}`, message: detail?.message || res.statusText } },
        message: detail?.message || `Operator API error ${res.status}`
      });
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') || '';
    return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
  }

  /* ---------------- Domains (clients) — §2 ---------------- */
  listDomains() { return this.req<string[]>('GET', '/domains'); }
  getDomain(domain: string) { return this.req<OperatorDomain>('GET', `/domains/${encodeURIComponent(domain)}`); }
  createDomain(domain: string, body: CreateDomainBody) { return this.req<void>('POST', `/domains/${encodeURIComponent(domain)}`, { body }); }
  editDomain(domain: string, body: Partial<CreateDomainBody>) { return this.req<void>('PUT', `/domains/${encodeURIComponent(domain)}`, { body }); }
  deleteDomain(domain: string) { return this.req<void>('DELETE', `/domains/${encodeURIComponent(domain)}`); }
  domainStats(domain: string) { return this.req<any>('GET', `/domains/${encodeURIComponent(domain)}/statistics`); }
  getDomainServices(domain: string) { return this.req<string[]>('GET', `/domains/${encodeURIComponent(domain)}/services`); }
  setDomainServices(domain: string, services: string[]) { return this.req<void>('PUT', `/domains/${encodeURIComponent(domain)}/services`, { body: { services } }); }
  blockDomain(domain: string) { return this.req<void>('POST', `/domains/${encodeURIComponent(domain)}/frozen`); }
  unblockDomain(domain: string) { return this.req<void>('DELETE', `/domains/${encodeURIComponent(domain)}/frozen`); }

  /* ---------------- Routes / Dialplans / Gateways — §7 ---------------- */
  listRoutes() { return this.req<Array<{ id: string; name: string }>>('GET', '/routes'); }
  listDialplans() { return this.req<Array<{ id: string; name: string }>>('GET', '/dialplans'); }
  listGateways() { return this.req<Array<{ id: string; name: string }>>('GET', '/gateways'); }

  /* ---------------- Employees — §4 ---------------- */
  listEmployees(domain: string) { return this.req<OperatorUser[]>('GET', `/domains/${encodeURIComponent(domain)}/users`); }
  createEmployee(domain: string, login: string, body: CreateEmployeeBody) {
    return this.req<OperatorUser>('POST', `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(login)}`, { body });
  }
  editEmployee(domain: string, login: string, body: Partial<CreateEmployeeBody>) {
    return this.req<OperatorUser>('PUT', `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(login)}`, { body });
  }
  deleteEmployee(domain: string, login: string) {
    return this.req<void>('DELETE', `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(login)}`);
  }
  generatePassword() { return this.req<{ password: string }>('GET', '/generatepassword'); }

  /* ---------------- Sessions — §8 (the no-password magic) ---------------- */
  // Login link as the domain's system user (admin view of that client).
  domainSession(domain: string) { return this.req<{ link: string }>('GET', `/domains/${encodeURIComponent(domain)}/session`); }
  // Login link on behalf of a specific employee — used to bridge a Telroi
  // employee straight into their Digitide UI with no password step.
  userSession(domain: string, login: string) {
    return this.req<{ link: string }>('GET', `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(login)}/session`);
  }
}

export async function resolveDomainDefaults(op: OperatorClient, settings: any): Promise<{
  extDigits: number; dialplan: string; route: string[]; services: string[]; allowedCallDirections: string[];
}> {
  let dialplan: string | undefined = settings?.operatorDialplanId || undefined;
  let route: string | undefined = settings?.operatorRouteId || undefined;
  if (!dialplan) { const dps = await op.listDialplans().catch(() => []); dialplan = dps?.[0]?.id; }
  if (!route) { const rs = await op.listRoutes().catch(() => []); route = rs?.[0]?.id; }
  if (!dialplan) throw createError({ statusCode: 422, message: 'No dialplan available on the operator account.' });
  if (!route) throw createError({ statusCode: 422, message: 'No route available on the operator account.' });
  const extDigits = Number(settings?.operatorExtDigits) || 3;
  const services: string[] = Array.isArray(settings?.operatorServices) && settings.operatorServices.length ? settings.operatorServices : ['autocaller'];
  return { extDigits, dialplan, route: [route], services, allowedCallDirections: ['LOCAL'] };
}

/* ---------------- Types ---------------- */
export interface OperatorDomain {
  name: string; accessURL: string; billingType: string; extDigits: number;
  maxLines: number; accountsLimit: number; accountsCount: number; frozen: boolean;
  language: string; languageList: string[]; services: string[];
  allowedCallDirections: string[]; client: string; ownRegion: string; sysdomain: boolean;
  countSIP: number;
}
export interface CreateDomainBody {
  name?: string; accessURL?: string; billingType?: string; extDigits?: number;
  maxLines?: number; accountsLimit?: number; language?: string;
  services?: string[]; allowedCallDirections?: string[]; client?: string; ownRegion?: string;
}
export interface OperatorUser {
  login: string; position?: string; realName?: string; email?: string;
  extension?: string; mobile?: string; role?: string; hasSIPPassword?: boolean;
}
export interface CreateEmployeeBody {
  position: string; realName: string; email?: string; extension?: string;
  mobile?: string; role?: 'admin' | 'user' | 'restricted_user'; password?: string; SIPPassword?: string;
}
