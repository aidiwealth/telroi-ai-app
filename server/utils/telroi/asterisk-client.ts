// server/utils/telroi/asterisk-client.ts
// The Asterisk-backed voice control client. Implements the same interface as
// TelroiClient (the old Digidite client), but talks to OUR PBX via the control-
// app agent instead of an external operator.
//
// Incremental build (Part B): capabilities are migrated to real Asterisk one at
// a time. Step 1 implements makeCall (outbound origination) for real. Every
// other method delegates to the sandbox simulation for now, so live tenants keep
// working until each capability is built on ARI in later steps. As each method
// is implemented for real here, it's removed from the delegated set.

import { agentOriginate, agentProvision, agentDeprovision, provisionAgentConfigured } from '~/server/utils/provision-agent';
import { encrypt } from '~/server/utils/crypto';
import { SandboxTelroiClient } from './sandbox-client';
import { useDb, schema } from '~/server/db';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { detectRegion } from '~/server/utils/regions';

// Map a destination region to the Asterisk trunk endpoint that carries its
// outbound calls. Nigeria → kasooko trunk; others fall back to it too for now
// (Twilio/Telnyx numbers never reach here — placeCall routes those to their
// APIs before this client is used). Configurable via env if needed.
function trunkForRegion(region: string): string {
  const map: Record<string, string> = {
    NG: process.env.TRUNK_NG || 'kasooko-endpoint'
  };
  return map[region] || process.env.TRUNK_DEFAULT || 'kasooko-endpoint';
}

export class AsteriskClient {
  private tenantId: string;
  private sim: SandboxTelroiClient;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    // Simulation backstop for not-yet-migrated capabilities (Steps 2-6).
    this.sim = new SandboxTelroiClient(tenantId);
  }

  static forTenant(tenant: { id: string }) {
    return new AsteriskClient(tenant.id);
  }

  // --- Resolve an agent (user login) to their registered Asterisk endpoint ---
  private async agentEndpointFor(user?: string): Promise<string> {
    const db = useDb();
    // `user` is a membership pbxLogin (or the sip_username directly). Find the
    // tenant's SIP endpoint whose username matches, and dial PJSIP/<username>.
    if (user) {
      const [ep] = await db.select().from(schema.sipEndpoints)
        .where(and(eq(schema.sipEndpoints.tenantId, this.tenantId), eq(schema.sipEndpoints.sipUsername, user)))
        .limit(1);
      if (ep?.sipUsername) return `PJSIP/${ep.sipUsername}`;
    }
    // Fallback: the tenant's first registration endpoint.
    const [first] = await db.select().from(schema.sipEndpoints)
      .where(and(eq(schema.sipEndpoints.tenantId, this.tenantId), eq(schema.sipEndpoints.kind, 'registration')))
      .limit(1);
    if (first?.sipUsername) return `PJSIP/${first.sipUsername}`;
    throw Object.assign(new Error('No registered SIP device for this agent. Provision a device first.'), {
      statusCode: 409, data: { error: { code: 'no_device', message: 'No registered SIP device for this agent.' } }
    });
  }

  // === STEP 1 — real outbound origination ===================================
  async makeCall(body: { phone: string; user?: string; group?: string; clid?: string; show_phone?: boolean; trunk?: string }): Promise<{ callid: string; clid?: string }> {
    if (!provisionAgentConfigured()) {
      throw Object.assign(new Error('PBX agent not configured'), {
        statusCode: 503, data: { error: { code: 'agent_unconfigured', message: 'Voice platform is not configured.' } }
      });
    }
    const agentEndpoint = await this.agentEndpointFor(body.user);
    const region = detectRegion(body.phone);
    const trunk = body.trunk || trunkForRegion(region);
    const r = await agentOriginate({
      agentEndpoint,
      to: body.phone.replace(/[^\d+]/g, ''),
      trunk,
      callerId: body.clid,
      tenantId: this.tenantId,
      user: body.user
    });
    return { callid: r.callid, clid: body.clid };
  }

  // === STEPS 2-6 — delegated to simulation until built on ARI ================
  // History
  // === STEP 5 — real call history (read-only, sourced from call_events) =======
  // Translate period -> a since-date window.
  private periodSince(period?: string): Date | null {
    const now = Date.now();
    switch ((period || '').toString()) {
      case 'day': return new Date(now - 1 * 24 * 3600 * 1000);
      case 'week': return new Date(now - 7 * 24 * 3600 * 1000);
      case 'month': return new Date(now - 30 * 24 * 3600 * 1000);
      case 'quarter': return new Date(now - 90 * 24 * 3600 * 1000);
      case 'all': return null;
      default: return new Date(now - 30 * 24 * 3600 * 1000); // sensible default
    }
  }

  // Map a call_events row -> the TelroiCall shape callers expect.
  private rowToCall(e: any) {
    return {
      uid: e.callid,
      type: e.direction || e.type || 'out',          // in | out
      status: e.status || 'completed',
      client: e.phone || '\u2014',
      user: e.user || undefined,
      start: (e.startedAt || e.createdAt)?.toISOString?.() || String(e.startedAt || e.createdAt),
      wait: e.wait || 0,
      duration: e.duration || 0,
      record: e.recordingUrl || undefined,
      rating: e.rating ?? undefined
    };
  }

  async historyJson(query: Record<string, any> = {}): Promise<any[]> {
    const db = useDb();
    const conds: any[] = [eq(schema.callEvents.tenantId, this.tenantId)];
    const since = this.periodSince(query.period);
    if (since) conds.push(gte(schema.callEvents.startedAt, since));
    if (query.start) conds.push(gte(schema.callEvents.startedAt, new Date(query.start)));
    if (query.end) conds.push(lte(schema.callEvents.startedAt, new Date(query.end)));
    if (query.type === 'in' || query.type === 'out') conds.push(eq(schema.callEvents.direction, query.type));
    if (query.user) conds.push(eq(schema.callEvents.user, String(query.user)));

    const limit = Math.min(Number(query.limit) || 100, 50000);
    const rows = await db.select().from(schema.callEvents)
      .where(and(...conds))
      .orderBy(desc(schema.callEvents.startedAt))
      .limit(limit);
    return rows.map((e) => this.rowToCall(e));
  }

  // CSV serialization mirrors the columns the export endpoint expects.
  async historyCsv(query: Record<string, any> = {}): Promise<string> {
    const calls = await this.historyJson(query);
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Direction', 'Status', 'From/Client', 'Agent', 'Number', 'Wait (s)', 'Duration (s)', 'Rating'];
    let out = header.map(esc).join(',') + '\n';
    for (const c of calls) {
      out += [c.start, c.type, c.status, c.client, c.user || '', (c as any).diversion || '', c.wait ?? '', c.duration ?? '', c.rating ?? ''].map(esc).join(',') + '\n';
    }
    return out;
  }

  // Raw variant — same source rows, used by the optimize endpoints.
  async innerHistoryJson(query: Record<string, any> = {}): Promise<any[]> {
    return this.historyJson(query);
  }
  // === STEP 4 (read half) — real user/agent reads from memberships =========
  // Writes (addUser/editUser/deleteUser) + DND still delegate to sandbox: they
  // need PJSIP provisioning + a DND schema column, deferred to a focused task.
  async listUsers(_q: Record<string, any> = {}): Promise<{ items: any[]; info: any }> {
    const db = useDb();
    const rows = await db.select({
      userId: schema.memberships.userId, role: schema.memberships.role,
      pbxLogin: schema.memberships.pbxLogin, name: schema.users.name, email: schema.users.email
    }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.tenantId, this.tenantId));
    const items = rows.map((x, i) => ({
      login: x.pbxLogin || (x.email || `user${i}`).split('@')[0],
      name: x.name || x.email || undefined,
      email: x.email || undefined,
      ext: x.pbxLogin || String(1001 + i),
      role: x.role,
      status: 'unknown'
    }));
    return { items, info: { search: '', total: items.length, start: 0, limit: items.length } };
  }

  async getUser(login: string, _q: Record<string, any> = {}): Promise<any> {
    const all = await this.listUsers();
    return all.items.find((u: any) => u.login === login) || { login, name: login };
  }

  async userGroups(login: string): Promise<Array<{ id: string; name: string; ext: string }>> {
    const db = useDb();
    const rows = await db.select({
      userId: schema.memberships.userId, pbxLogin: schema.memberships.pbxLogin, email: schema.users.email
    }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.tenantId, this.tenantId));
    const me = rows.find((r) => (r.pbxLogin || (r.email || '').split('@')[0]) === login);
    if (!me) return [];
    const depts = await db.select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departmentMembers)
      .innerJoin(schema.departments, eq(schema.departmentMembers.departmentId, schema.departments.id))
      .where(and(eq(schema.departmentMembers.tenantId, this.tenantId), eq(schema.departmentMembers.userId, me.userId)));
    return depts.map((d) => ({ id: d.id, name: d.name, ext: '' }));
  }

  // === STEP 4 (write half) — provision/deprovision PBX agent extensions ======
  // addUser creates a real PJSIP endpoint (desk extension) via the provisioning
  // agent and persists a sip_endpoints row (same pattern as ensureWebrtcEndpoint,
  // but webrtc=false). The calling endpoint (agents.post.ts) handles linking
  // memberships.pbxLogin afterward. DND still delegates (needs a schema column).
  async addUser(body: Record<string, any>): Promise<any> {
    const login = String(body?.login || '').trim();
    if (!login) throw new Error('login required');
    if (!provisionAgentConfigured()) {
      return (this.sim as any).addUser?.(body);
    }
    const db = useDb();
    const existingRows = await db.select().from(schema.sipEndpoints)
      .where(and(eq(schema.sipEndpoints.tenantId, this.tenantId), eq(schema.sipEndpoints.provider, 'telroi')));
    const already = existingRows.find((r: any) => r.label === login || r.sipUsername === login);
    if (already) {
      return { login, name: body.name, email: body.email, ext: already.sipUsername || login };
    }
    const result = await agentProvision(this.tenantId, login, false);
    await db.insert(schema.sipEndpoints).values({
      tenantId: this.tenantId, provider: 'telroi', kind: 'registration',
      externalId: result.username, label: login, sipUsername: result.username,
      secretEnc: encrypt(result.password), domain: result.domain,
      meta: { transport: result.transport, agent: true }
    });
    return { login, name: body.name, email: body.email, ext: result.username };
  }

  async editUser(login: string, _body: Record<string, any>): Promise<any> {
    return this.getUser(login);
  }

  async deleteUser(login: string): Promise<void> {
    const db = useDb();
    const rows = await db.select().from(schema.sipEndpoints)
      .where(and(eq(schema.sipEndpoints.tenantId, this.tenantId), eq(schema.sipEndpoints.provider, 'telroi')));
    const ep = rows.find((r: any) => r.sipUsername === login || r.label === login);
    if (ep) {
      if (provisionAgentConfigured() && ep.sipUsername) {
        try { await agentDeprovision(ep.sipUsername); } catch { /* endpoint may already be gone */ }
      }
      await db.delete(schema.sipEndpoints).where(eq(schema.sipEndpoints.id, ep.id));
    }
    try {
      await db.update(schema.memberships).set({ pbxLogin: null })
        .where(and(eq(schema.memberships.tenantId, this.tenantId), eq(schema.memberships.pbxLogin, login)));
    } catch { /* best-effort */ }
  }

  // DND now backed by memberships.dnd. Resolve the membership by login
  // (pbxLogin or email local-part), then read/write the flag.
  private async membershipForLogin(login: string) {
    const db = useDb();
    const rows = await db.select({
      mid: schema.memberships.id, dnd: schema.memberships.dnd,
      pbxLogin: schema.memberships.pbxLogin, email: schema.users.email
    }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.tenantId, this.tenantId));
    return rows.find((r) => (r.pbxLogin || (r.email || '').split('@')[0]) === login);
  }

  async getDnd(login: string): Promise<{ state: boolean }> {
    const m = await this.membershipForLogin(login);
    return { state: !!m?.dnd };
  }

  async setDnd(login: string, on: boolean): Promise<void> {
    const m = await this.membershipForLogin(login);
    if (!m) return;
    const db = useDb();
    await db.update(schema.memberships).set({ dnd: !!on })
      .where(eq(schema.memberships.id, m.mid));
  }
  // Groups / departments
  // === STEP 3 — real departments/ring-groups (CRUD on departments +
  // department_members). Call-time ring distribution (simultaneous/round-robin)
  // is read from ringStrategy by the control-app; that distribution logic is a
  // separate task. These methods own the team + membership records. ==========
  private groupRow(d: any) {
    return {
      id: d.id, name: d.name, ext: '',
      call_order: d.ringStrategy,
      timeout: { time: d.ringTimeout, target: 'hangup' },
      users: [] as any[]
    };
  }

  async listGroups(_q: Record<string, any> = {}): Promise<{ items: any[]; info: any }> {
    const db = useDb();
    const rows = await db.select().from(schema.departments)
      .where(eq(schema.departments.tenantId, this.tenantId));
    const items = rows.map((d) => this.groupRow(d));
    return { items, info: { search: '', total: items.length, start: 0, limit: items.length } };
  }

  async getGroup(id: string): Promise<any> {
    const db = useDb();
    const [d] = await db.select().from(schema.departments)
      .where(and(eq(schema.departments.tenantId, this.tenantId), eq(schema.departments.id, id))).limit(1);
    return d ? this.groupRow(d) : { id, name: 'Team' };
  }

  private groupVals(body: Record<string, any>) {
    const b = body || {};
    const vals: Record<string, any> = {};
    if (b.name !== undefined) vals.name = b.name;
    if (b.description !== undefined) vals.description = b.description;
    const order = b.call_order || b.ringStrategy;
    if (order !== undefined) vals.ringStrategy = order;
    const timeout = b.timeout?.time ?? b.ringTimeout;
    if (timeout !== undefined) vals.ringTimeout = Number(timeout);
    return vals;
  }

  async addGroup(body: Record<string, any>): Promise<any> {
    const db = useDb();
    const vals = this.groupVals(body);
    if (!vals.name) vals.name = 'Team';
    const [created] = await db.insert(schema.departments)
      .values({ tenantId: this.tenantId, ...vals }).returning();
    return this.groupRow(created);
  }

  async editGroup(id: string, body: Record<string, any>): Promise<any> {
    const db = useDb();
    const vals = this.groupVals(body);
    if (Object.keys(vals).length) {
      await db.update(schema.departments).set(vals)
        .where(and(eq(schema.departments.tenantId, this.tenantId), eq(schema.departments.id, id)));
    }
    return this.getGroup(id);
  }

  async deleteGroup(id: string): Promise<void> {
    const db = useDb();
    await db.delete(schema.departments)
      .where(and(eq(schema.departments.tenantId, this.tenantId), eq(schema.departments.id, id)));
  }

  async changeGroupUsers(id: string, body: Record<string, any>): Promise<void> {
    const db = useDb();
    const raw = (body?.users ?? body?.userIds ?? []) as any[];
    const userIds = raw.map((u) => (typeof u === 'string' ? u : u?.userId || u?.id)).filter(Boolean);
    const [dept] = await db.select().from(schema.departments)
      .where(and(eq(schema.departments.tenantId, this.tenantId), eq(schema.departments.id, id))).limit(1);
    if (!dept) return;
    await db.delete(schema.departmentMembers)
      .where(and(eq(schema.departmentMembers.tenantId, this.tenantId), eq(schema.departmentMembers.departmentId, id)));
    for (const userId of userIds) {
      await db.insert(schema.departmentMembers)
        .values({ tenantId: this.tenantId, departmentId: id, userId })
        .onConflictDoNothing();
    }
  }
  // === STEP 2 — real number routing (writes the authoritative DB record the
  // control-app cache reads at call time; propagates within the cache refresh) ==
  // Look up a tenant-scoped subscription by telnum.
  private async subFor(telnum: string) {
    const db = useDb();
    const [sub] = await db.select().from(schema.numberSubscriptions)
      .where(and(eq(schema.numberSubscriptions.tenantId, this.tenantId), eq(schema.numberSubscriptions.telnum, telnum)))
      .limit(1);
    if (!sub) throw Object.assign(new Error('Number not found for this tenant'), {
      statusCode: 404, data: { error: { code: 'not_found', message: 'Number not found.' } }
    });
    return sub;
  }

  // Translate the various caller body shapes into number_subscriptions columns.
  //   { type:'avm', avm:{ mode:'ai', van_id } }   -> ai
  //   { type:'user', user } / { routeType:'person', target }  -> person
  //   { type:'group', group } / { routeType:'department', departmentId } -> department
  async editNumberRoute(telnum: string, body: Record<string, any>): Promise<{ telnum: string; routeType: string }> {
    const sub = await this.subFor(telnum);
    const db = useDb();
    const b = body || {};
    const type = (b.routeType || b.type || '').toString();

    const vals: Record<string, any> = {};
    if (type === 'ai' || type === 'avm') {
      vals.routeType = 'ai';
      vals.routeAgentId = b.agentId || b.avm?.agent_id || sub.routeAgentId || null;
      vals.routeTarget = null;
      vals.routeEscalateTo = b.escalateTo || b.avm?.escalate_to || null;
      vals.routeEscalateAfter = b.escalateAfter ?? b.avm?.escalate_after ?? 0;
    } else if (type === 'department' || type === 'group') {
      vals.routeType = 'department';
      vals.departmentId = b.departmentId || b.group || sub.departmentId || null;
      vals.routeTarget = null;
      vals.routeAgentId = null;
    } else {
      // person (default)
      vals.routeType = 'person';
      vals.routeTarget = b.target || b.user || b.extension || sub.routeTarget || null;
      vals.routeAgentId = null;
    }

    await db.update(schema.numberSubscriptions).set(vals)
      .where(eq(schema.numberSubscriptions.id, sub.id));
    return { telnum, routeType: vals.routeType };
  }

  async enableNumber(telnum: string): Promise<void> {
    const sub = await this.subFor(telnum);
    const db = useDb();
    await db.update(schema.numberSubscriptions).set({ status: 'active' })
      .where(eq(schema.numberSubscriptions.id, sub.id));
  }

  async disableNumber(telnum: string): Promise<void> {
    const sub = await this.subFor(telnum);
    const db = useDb();
    await db.update(schema.numberSubscriptions).set({ status: 'suspended' })
      .where(eq(schema.numberSubscriptions.id, sub.id));
  }

  // listNumbers / getNumber remain DB reads via the sandbox for now (read-only,
  // migrated in a later step alongside call history).
  // === Numbers — real reads from number_subscriptions (the Numbers page). ====
  private subToNumber(n: any) {
    return {
      telnum: n.telnum,
      name: n.region || undefined,
      type: n.routeType,
      enabled: n.status === 'active',
      disabled: n.status !== 'active',
      location: n.region || undefined,
      user: n.routeType === 'person' ? (n.routeTarget || undefined) : undefined,
      group: n.routeType === 'department' ? (n.departmentId || undefined) : undefined,
      status: n.status
    };
  }

  async listNumbers(_q: Record<string, any> = {}): Promise<{ items: any[]; info: any }> {
    const db = useDb();
    const rows = await db.select().from(schema.numberSubscriptions)
      .where(eq(schema.numberSubscriptions.tenantId, this.tenantId));
    const items = rows.map((n) => this.subToNumber(n));
    return { items, info: { search: '', total: items.length, start: 0, limit: items.length } };
  }

  async getNumber(telnum: string): Promise<any> {
    const db = useDb();
    const [n] = await db.select().from(schema.numberSubscriptions)
      .where(and(eq(schema.numberSubscriptions.tenantId, this.tenantId), eq(schema.numberSubscriptions.telnum, telnum)))
      .limit(1);
    return n ? this.subToNumber(n) : { telnum, enabled: false };
  }
  // === STEP 6 — real blacklist (writes the blacklist table the control-app
  // cache reads; inbound handler rejects matching callers within ~30s) ========
  async blacklist(_q: Record<string, any> = {}): Promise<Array<{ telnum: string; comment?: string }>> {
    const db = useDb();
    const rows = await db.select().from(schema.blacklist)
      .where(eq(schema.blacklist.tenantId, this.tenantId));
    return rows.map((r) => ({ telnum: r.telnum, comment: r.comment || undefined }));
  }

  async addBlacklist(entries: Array<{ telnum: string; comment?: string }>): Promise<void> {
    const db = useDb();
    const list = Array.isArray(entries) ? entries : [entries];
    for (const e of list) {
      if (!e?.telnum) continue;
      const [existing] = await db.select().from(schema.blacklist)
        .where(and(eq(schema.blacklist.tenantId, this.tenantId), eq(schema.blacklist.telnum, e.telnum))).limit(1);
      if (!existing) {
        await db.insert(schema.blacklist).values({ tenantId: this.tenantId, telnum: e.telnum, comment: e.comment || null });
      } else if (e.comment !== undefined) {
        await db.update(schema.blacklist).set({ comment: e.comment || null }).where(eq(schema.blacklist.id, existing.id));
      }
    }
  }

  async deleteBlacklist(telnums: string[]): Promise<void> {
    const db = useDb();
    const list = Array.isArray(telnums) ? telnums : [telnums];
    for (const telnum of list) {
      if (!telnum) continue;
      await db.delete(schema.blacklist)
        .where(and(eq(schema.blacklist.tenantId, this.tenantId), eq(schema.blacklist.telnum, telnum)));
    }
  }

  // Anonymous-caller block has no per-tenant storage yet; keep the sandbox no-op
  // until a tenant setting + dialplan check is added (separate task).
  getAnonymousBlock() { return (this.sim as any).getAnonymousBlock?.(); }
  setAnonymousBlock(on: boolean) { return (this.sim as any).setAnonymousBlock?.(on); }
  sipRegistrations(q: Record<string, any> = {}) { return (this.sim as any).sipRegistrations?.(q); }
  addSipRegistration(b: Record<string, any>) { return (this.sim as any).addSipRegistration?.(b); }
  deleteSipRegistration(telnum: string) { return (this.sim as any).deleteSipRegistration?.(telnum); }
}
