// server/utils/telroi/client.ts
// Typed client for the Digitide/Telroi CPBX REST API (see rest_api PDF).
// Base: https://{domain}/crmapi/v1/   Auth: header X-API-KEY: {key}
//
// This is the PRIMARY voice backend. Each method maps to an endpoint in the
// spec. When the mock URL is configured (dev/offline), requests target it.
import { decrypt } from '../crypto';

export interface TelroiCreds {
  domain: string;   // e.g. acme.telroi.com
  apiKey: string;   // plaintext (decrypt before constructing)
}

export interface TelroiClientOpts {
  /** Override base URL entirely (used by the local mock). */
  baseOverride?: string;
}

export class TelroiClient {
  private base: string;
  private apiKey: string;
  private tenantDomain: string;

  constructor(creds: TelroiCreds, opts: TelroiClientOpts = {}) {
    const mock = useRuntimeConfig().telroiMockUrl;
    this.base = opts.baseOverride || mock || `https://${creds.domain}/crmapi/v1`;
    this.apiKey = creds.apiKey;
    this.tenantDomain = creds.domain;
  }

  /** Build a client for a tenant from its encrypted key + domain. */
  static forTenant(tenant: { telroiDomain: string | null; telroiApiKeyEnc: string | null }) {
    if (!tenant.telroiDomain || !tenant.telroiApiKeyEnc) {
      throw createError({
        statusCode: 409,
        data: { error: { code: 'voice_not_live', message: "Voice goes live once your account is verified. Complete verification and switch your workspace to Live to start making and taking real calls — you can explore everything in sandbox until then." } },
        message: "Voice goes live once your account is verified. Complete verification and switch to Live to start real calls."
      });
    }
    return new TelroiClient({ domain: tenant.telroiDomain, apiKey: decrypt(tenant.telroiApiKeyEnc) });
  }

  private async req<T>(method: string, path: string, opts: { query?: Record<string, any>; body?: any } = {}): Promise<T> {
    const url = new URL(this.base.replace(/\/$/, '') + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
        else url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        'X-API-KEY': this.apiKey,
        'X-Telroi-Domain': this.tenantDomain,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    if (!res.ok) {
      // Map the spec's documented error codes through.
      let detail: any = null;
      try { detail = await res.json(); } catch { /* csv / empty */ }
      throw createError({
        statusCode: res.status,
        data: { error: { code: `telroi_${res.status}`, message: detail?.message || res.statusText } },
        message: detail?.message || `Telroi error ${res.status}`
      });
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') || '';
    return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
  }

  /* ---------------- Call history (§4) ---------------- */
  historyJson(query: Record<string, any>) {
    return this.req<TelroiCall[]>('GET', '/history/json', { query });
  }
  historyCsv(query: Record<string, any>) {
    return this.req<string>('GET', '/history/csv', { query });
  }
  innerHistoryJson(query: Record<string, any>) {
    return this.req<any[]>('GET', '/history/inner/json', { query });
  }

  /* ---------------- Outgoing / click-to-call (§5) ---------------- */
  makeCall(body: { phone: string; user?: string; group?: string; clid?: string; show_phone?: boolean }) {
    return this.req<{ callid: string; clid?: string }>('POST', '/makecall', { body });
  }

  /* ---------------- Employees / agents (§6) ---------------- */
  listUsers(query: Record<string, any> = {}) {
    return this.req<{ items: TelroiUser[]; info: TelroiPageInfo }>('GET', '/users', { query });
  }
  getUser(login: string, query: Record<string, any> = {}) {
    return this.req<TelroiUser>('GET', `/users/${encodeURIComponent(login)}`, { query });
  }
  addUser(body: Record<string, any>) {
    return this.req<TelroiUser>('POST', '/users', { body });
  }
  editUser(login: string, body: Record<string, any>) {
    return this.req<TelroiUser>('PUT', `/users/${encodeURIComponent(login)}`, { body });
  }
  deleteUser(login: string) {
    return this.req<void>('DELETE', `/users/${encodeURIComponent(login)}`);
  }
  userGroups(login: string) {
    return this.req<{ id: string; name: string; ext: string }[]>('GET', `/users/${encodeURIComponent(login)}/groups`);
  }
  getDnd(login: string) {
    return this.req<{ state: boolean }>('GET', `/users/${encodeURIComponent(login)}/dnd`);
  }
  setDnd(login: string, on: boolean) {
    return this.req<void>(on ? 'POST' : 'DELETE', `/users/${encodeURIComponent(login)}/dnd`);
  }

  /* ---------------- Departments / queues (§8) ---------------- */
  listGroups(query: Record<string, any> = {}) {
    return this.req<{ items: TelroiGroup[]; info: TelroiPageInfo }>('GET', '/groups', { query });
  }
  getGroup(id: string) {
    return this.req<TelroiGroup>('GET', `/groups/${encodeURIComponent(id)}`);
  }
  addGroup(body: Record<string, any>) {
    return this.req<TelroiGroup>('POST', '/groups', { body });
  }
  editGroup(id: string, body: Record<string, any>) {
    return this.req<TelroiGroup>('PUT', `/groups/${encodeURIComponent(id)}`, { body });
  }
  deleteGroup(id: string) {
    return this.req<void>('DELETE', `/groups/${encodeURIComponent(id)}`);
  }
  changeGroupUsers(id: string, body: Record<string, any>) {
    return this.req<void>('POST', `/groups/${encodeURIComponent(id)}/users`, { body });
  }

  /* ---------------- Numbers (§9) ---------------- */
  listNumbers(query: Record<string, any> = {}) {
    return this.req<{ items: TelroiNumber[]; info: TelroiPageInfo }>('GET', '/telnums', { query });
  }
  getNumber(telnum: string) {
    return this.req<TelroiNumber>('GET', `/telnums/${encodeURIComponent(telnum)}`);
  }
  editNumberRoute(telnum: string, body: Record<string, any>) {
    return this.req<TelroiNumber>('POST', `/telnums/${encodeURIComponent(telnum)}`, { body });
  }
  enableNumber(telnum: string) {
    return this.req<void>('POST', `/telnums/${encodeURIComponent(telnum)}/enabled`);
  }
  disableNumber(telnum: string) {
    return this.req<void>('DELETE', `/telnums/${encodeURIComponent(telnum)}/enabled`);
  }

  /* ---------------- Blacklist (§10) ---------------- */
  blacklist(query: Record<string, any> = {}) {
    return this.req<TelroiBlacklistEntry[]>('GET', '/blacklist/telnums', { query });
  }
  addBlacklist(body: { telnum: string; comment?: string }[]) {
    return this.req<void>('POST', '/blacklist/telnums', { body });
  }
  deleteBlacklist(telnums: string[]) {
    return this.req<void>('DELETE', '/blacklist/telnums', { query: { telnum: telnums } });
  }
  getAnonymousBlock() {
    return this.req<{ state: boolean }>('GET', '/blacklist/block-anonymous');
  }
  setAnonymousBlock(on: boolean) {
    return this.req<void>(on ? 'POST' : 'DELETE', '/blacklist/block-anonymous');
  }

  /* ---------------- Domain & settings (§11) ---------------- */
  domain() { return this.req<TelroiDomain>('GET', '/domain'); }
  music() { return this.req<any>('GET', '/music'); }
  mediaCatalog(type: string) { return this.req<{ id: string; name: string }[]>('GET', `/media-catalog/${type}`); }
  recordSettings() { return this.req<any>('GET', '/record'); }
  callerIds() { return this.req<any>('GET', '/caller-ids'); }
  restrictions() { return this.req<any>('GET', '/calls-restrictions'); }

  /* ---------------- SIP registrations (§14) ---------------- */
  sipRegistrations(query: Record<string, any> = {}) {
    return this.req<{ items: any[]; info: TelroiPageInfo }>('GET', '/sip-registrations', { query });
  }
  addSipRegistration(body: Record<string, any>) {
    return this.req<any>('POST', '/sip-registrations', { body });
  }
  deleteSipRegistration(telnum: string) {
    return this.req<void>('DELETE', `/sip-registrations/${encodeURIComponent(telnum)}`);
  }

  /* ---------------- Webhooks (§17) ---------------- */
  listWebhooks() { return this.req<any[]>('GET', '/webhook'); }
  addWebhook(body: { type: string; url: string }) { return this.req<void>('POST', '/webhook', { body }); }
  deleteWebhook(id: string) { return this.req<void>('DELETE', `/webhook/${encodeURIComponent(id)}`); }
}

/* ---------------- Response types (from the spec) ---------------- */
export interface TelroiPageInfo { search: string; total: number; start: number; limit: number; next?: number; }
export interface TelroiCall {
  uid: string; type: string; status: string; client: string; diversion?: string;
  telnum_name?: string; destination?: string; user?: string; user_name?: string;
  group_name?: string; start: string; wait: number; duration: number;
  record?: string; rating?: number; note?: string; missedStatus?: number;
}
export interface TelroiUser {
  login: string; name?: string; position?: string; ext?: string; telnum?: string;
  email?: string; role?: string; mobile?: string;
  mobile_redirect?: { enabled: boolean; forward?: boolean; delay?: number };
  status?: string; dnd?: boolean;
}
export interface TelroiGroup {
  id: string; name: string; ext?: string; call_order?: string; call_duration?: number;
  users?: any[]; timeout?: any; advanced?: string; queue_position?: boolean;
}
export interface TelroiNumber {
  telnum: string; name?: string; type: string; greeting?: boolean; is_main_phone?: boolean;
  location?: string; disabled?: boolean; user?: string; user_name?: string;
  group?: string; group_name?: string; [k: string]: any;
}
export interface TelroiBlacklistEntry { telnum: string; comment?: string; week?: number; year?: number; }
export interface TelroiDomain { timezone: { name: string; offset: number }; limits: any; services: any; }
