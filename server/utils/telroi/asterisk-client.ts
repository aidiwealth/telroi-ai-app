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

import { agentOriginate, provisionAgentConfigured } from '~/server/utils/provision-agent';
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
  // Users / agents
  listUsers(q: Record<string, any> = {}) { return (this.sim as any).listUsers?.(q); }
  getUser(login: string, q: Record<string, any> = {}) { return (this.sim as any).getUser?.(login, q); }
  addUser(b: Record<string, any>) { return (this.sim as any).addUser?.(b); }
  editUser(login: string, b: Record<string, any>) { return (this.sim as any).editUser?.(login, b); }
  deleteUser(login: string) { return (this.sim as any).deleteUser?.(login); }
  userGroups(login: string) { return (this.sim as any).userGroups?.(login); }
  getDnd(login: string) { return (this.sim as any).getDnd?.(login); }
  setDnd(login: string, on: boolean) { return (this.sim as any).setDnd?.(login, on); }
  // Groups / departments
  listGroups(q: Record<string, any> = {}) { return (this.sim as any).listGroups?.(q); }
  getGroup(id: string) { return (this.sim as any).getGroup?.(id); }
  addGroup(b: Record<string, any>) { return (this.sim as any).addGroup?.(b); }
  editGroup(id: string, b: Record<string, any>) { return (this.sim as any).editGroup?.(id, b); }
  deleteGroup(id: string) { return (this.sim as any).deleteGroup?.(id); }
  changeGroupUsers(id: string, b: Record<string, any>) { return (this.sim as any).changeGroupUsers?.(id, b); }
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
  listNumbers(q: Record<string, any> = {}) { return (this.sim as any).listNumbers?.(q); }
  getNumber(telnum: string) { return (this.sim as any).getNumber?.(telnum); }
  // Blacklist / DND / SIP
  blacklist(q: Record<string, any> = {}) { return (this.sim as any).blacklist?.(q); }
  addBlacklist(b: any) { return (this.sim as any).addBlacklist?.(b); }
  deleteBlacklist(t: string[]) { return (this.sim as any).deleteBlacklist?.(t); }
  getAnonymousBlock() { return (this.sim as any).getAnonymousBlock?.(); }
  setAnonymousBlock(on: boolean) { return (this.sim as any).setAnonymousBlock?.(on); }
  sipRegistrations(q: Record<string, any> = {}) { return (this.sim as any).sipRegistrations?.(q); }
  addSipRegistration(b: Record<string, any>) { return (this.sim as any).addSipRegistration?.(b); }
  deleteSipRegistration(telnum: string) { return (this.sim as any).deleteSipRegistration?.(telnum); }
}
