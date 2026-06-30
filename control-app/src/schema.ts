// control-app/src/schema.ts
// Minimal, self-contained Drizzle schema for the control app.
//
// WHY a local copy instead of importing the main app's server/db/schema.ts:
// the control app is deployed standalone on the Asterisk Droplet with its own
// node_modules. Reaching into the parent repo's schema would also pull that
// file's drizzle-orm resolution from the WRONG node_modules. Keeping a small
// local schema makes control-app/ fully self-contained and deployable alone.
//
// IMPORTANT: these table/column names MUST match the main schema exactly (they
// point at the same Postgres tables). Only the columns the control app actually
// reads or writes are declared here. If you add a routing column in the main
// app that the control app needs, mirror it here.
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

// We only need tenant id for FK targets; declared minimally.
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom()
});

export const numberSubscriptions = pgTable('number_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  telnum: text('telnum').notNull(),
  status: text('status').notNull().default('active'),
  departmentId: uuid('department_id'),
  routeType: text('route_type').notNull().default('person'),
  routeTarget: text('route_target'),
  routeAgentId: uuid('route_agent_id'),
  routeEscalateTo: text('route_escalate_to'),
  routeEscalateAfter: integer('route_escalate_after').default(0)
}, (t) => ({
  telnumIdx: uniqueIndex('number_subs_telnum_idx').on(t.telnum)
}));

export const blacklist = pgTable('blacklist', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  telnum: text('telnum').notNull()
}, (t) => ({
  uniqByTenant: uniqueIndex('blacklist_tenant_telnum_idx').on(t.tenantId, t.telnum)
}));

export const aiAgents = pgTable('ai_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  greeting: text('greeting')
});

// sip_endpoints — a client's provisioned SIP device (Telroi's credential store).
// route_target on a person route holds this row's id (Option B); the control app
// resolves it to sip_username and bridges to PJSIP/<sip_username>.
export const sipEndpoints = pgTable('sip_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  label: text('label'),
  sipUsername: text('sip_username'),
  domain: text('domain')
});

// Minimal: membership links a user to a tenant and holds their PBX login
// (the SIP username we ring for department members). Option 1: one device/user.
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  pbxLogin: text('pbx_login')
});

// Minimal: a user's membership in a department, with the can-take-calls flag.
export const departmentMembers = pgTable('department_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  canTakeCalls: boolean('can_take_calls').notNull().default(true)
});

export const callEvents = pgTable('call_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  callid: text('callid').notNull(),
  direction: text('direction'),
  phone: text('phone'),
  status: text('status'),
  carrier: text('carrier'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  duration: integer('duration'),
  raw: jsonb('raw').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  callIdx: index('call_events_callid_idx').on(t.callid),
  uniqCall: uniqueIndex('call_events_tenant_callid_uidx').on(t.tenantId, t.callid)
}));
