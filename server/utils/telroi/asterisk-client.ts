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
import { and, eq } from 'drizzle-orm';
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
      callerId: body.clid
    });
    return { callid: r.callid, clid: body.clid };
  }

  // === STEPS 2-6 — delegated to simulation until built on ARI ================
  // History
  historyJson(q: Record<string, any>) { return this.sim.historyJson(q); }
  historyCsv(q: Record<string, any>) { return (this.sim as any).historyCsv?.(q); }
  innerHistoryJson(q: Record<string, any>) { return (this.sim as any).innerHistoryJson?.(q); }
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
