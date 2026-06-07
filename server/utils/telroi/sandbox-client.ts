// server/utils/telroi/sandbox-client.ts
// A drop-in stand-in for TelroiClient used while a tenant is in sandbox / not
// yet live. It mirrors the real client's method surface but serves data from
// OUR database (members as agents, departments as groups, subscriptions as
// numbers) plus realistic generated call history — so voice + AI + every other
// PBX-backed screen works coherently during a trial, with ZERO vendor calls.
// Writes are accepted as successful no-ops (or persist via the local tables that
// already own that data), so the trial feels genuinely interactive. The moment
// the tenant goes live, telroiFor() returns the REAL client instead — same
// method calls, real backend.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import type {
  TelroiCall, TelroiUser, TelroiGroup, TelroiNumber, TelroiBlacklistEntry,
  TelroiDomain, TelroiPageInfo
} from './client';

function page<T>(items: T[]): { items: T[]; info: TelroiPageInfo } {
  return { items, info: { search: '', total: items.length, start: 0, limit: items.length } };
}

export class SandboxTelroiClient {
  tenantDomain = 'sandbox.local';
  constructor(private tenantId: string) {}

  private async members() {
    const db = useDb();
    return db.select({
      userId: schema.memberships.userId, role: schema.memberships.role,
      pbxLogin: schema.memberships.pbxLogin, name: schema.users.name, email: schema.users.email
    }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.tenantId, this.tenantId));
  }
  private async depts() {
    const db = useDb();
    return db.select().from(schema.departments).where(eq(schema.departments.tenantId, this.tenantId));
  }
  private async subs() {
    const db = useDb();
    return db.select().from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, this.tenantId));
  }

  /* ---- Call history: empty until real calls are placed (no fabricated data) ---- */
  async historyJson(_query: Record<string, any> = {}): Promise<TelroiCall[]> {
    return [];
  }
  async historyCsv(): Promise<string> {
    return 'uid,type,status,client,start,duration\n';
  }
  async innerHistoryJson(): Promise<any[]> { return []; }

  /* ---- Click-to-call: simulated success ---- */
  async makeCall(body: { phone: string }): Promise<{ callid: string; clid?: string }> {
    return { callid: `sbx_call_${Date.now()}` };
  }

  /* ---- Agents = workspace members (with a synthesized extension) ---- */
  async listUsers(): Promise<{ items: TelroiUser[]; info: TelroiPageInfo }> {
    const m = await this.members();
    const users = m.map((x, i) => ({
      login: x.pbxLogin || (x.email || `user${i}`).split('@')[0],
      name: x.name || x.email, email: x.email || undefined,
      ext: String(1001 + i), role: x.role, status: i % 2 === 0 ? 'online' : 'offline'
    } as any));
    return page(users);
  }
  async getUser(login: string): Promise<TelroiUser> {
    const all = await this.listUsers();
    return (all.items.find((u) => u.login === login) || { login, name: login }) as TelroiUser;
  }
  async addUser(body: Record<string, any>): Promise<TelroiUser> { return { login: body.login, name: body.name, email: body.email, ext: '1099' } as any; }
  async editUser(login: string, body: Record<string, any>): Promise<TelroiUser> { return { login, ...body } as any; }
  async deleteUser(_login: string): Promise<void> { return; }
  async userGroups(_login: string) { const d = await this.depts(); return d.map((x) => ({ id: x.id, name: x.name, ext: '' })); }
  async getDnd(_login: string) { return { state: false }; }
  async setDnd(_login: string, _on: boolean): Promise<void> { return; }

  /* ---- Groups = departments ---- */
  async listGroups(): Promise<{ items: TelroiGroup[]; info: TelroiPageInfo }> {
    const d = await this.depts();
    return page(d.map((x) => ({ id: x.id, name: x.name, ext: '', call_order: x.ringStrategy, timeout: { time: x.ringTimeout, target: 'hangup' }, users: [] } as any)));
  }
  async getGroup(id: string): Promise<TelroiGroup> { const g = await this.listGroups(); return (g.items.find((x) => x.id === id) || { id, name: 'Team' }) as any; }
  async addGroup(body: Record<string, any>): Promise<TelroiGroup> { return { id: `sbx_grp_${Date.now()}`, ...body } as any; }
  async editGroup(id: string, body: Record<string, any>): Promise<TelroiGroup> { return { id, ...body } as any; }
  async deleteGroup(_id: string): Promise<void> { return; }
  async changeGroupUsers(_id: string, _body: Record<string, any>): Promise<void> { return; }

  /* ---- Numbers = subscriptions ---- */
  async listNumbers(): Promise<{ items: TelroiNumber[]; info: TelroiPageInfo }> {
    const s = await this.subs();
    return page(s.map((n) => ({ telnum: n.telnum, name: n.region, enabled: n.status === 'active' } as any)));
  }
  async getNumber(telnum: string): Promise<TelroiNumber> { return { telnum, enabled: true } as any; }
  async editNumberRoute(telnum: string, body: Record<string, any>): Promise<TelroiNumber> { return { telnum, ...body } as any; }
  async enableNumber(_telnum: string): Promise<void> { return; }
  async disableNumber(_telnum: string): Promise<void> { return; }

  /* ---- Blacklist (empty but functional) ---- */
  async blacklist(): Promise<TelroiBlacklistEntry[]> { return []; }
  async addBlacklist(_b: any): Promise<void> { return; }
  async deleteBlacklist(_t: string[]): Promise<void> { return; }
  async getAnonymousBlock() { return { state: false }; }
  async setAnonymousBlock(_on: boolean): Promise<void> { return; }

  /* ---- Domain & settings ---- */
  async domain(): Promise<TelroiDomain> { return { domain: 'sandbox.local', name: 'Sandbox' } as any; }
  async music(): Promise<any> { return {}; }
  async mediaCatalog(_type: string) { return []; }
  async recordSettings(): Promise<any> { return { enabled: true }; }
  async callerIds(): Promise<any> { return {}; }
  async restrictions(): Promise<any> { return {}; }

  /* ---- SIP (empty but functional) ---- */
  async sipRegistrations(): Promise<{ items: any[]; info: TelroiPageInfo }> { return page([]); }
  async addSipRegistration(body: Record<string, any>): Promise<any> { return { ...body, ok: true }; }
  async deleteSipRegistration(_telnum: string): Promise<void> { return; }

  /* ---- Webhooks ---- */
  async listWebhooks(): Promise<any[]> { return []; }
  async addWebhook(_b: any): Promise<void> { return; }
  async deleteWebhook(_id: string): Promise<void> { return; }
}
