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
//
// Forgetting is unusually expensive: selecting a column that is missing here
// hands drizzle an undefined and it fails inside Object.entries with "Cannot
// convert undefined or null to object" — a message that names neither the
// column nor the table. The cache catches it and keeps serving stale data, so
// routing continues and nothing looks broken. A missing departments table cost
// one session; a missing meta column cost three attempts in another.
//
// When a cache query fails, run the select on its own before theorising:
//   node --experimental-strip-types -e "import('./control-app/src/db.ts')..."
// The real stack names the line in drizzle and the answer follows immediately.
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

// We only need tenant id for FK targets; declared minimally.
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  blockAnonymous: boolean('block_anonymous').notNull().default(false)
});

export const numberSubscriptions = pgTable('number_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  telnum: text('telnum').notNull(),
  provider: text('provider'),
  status: text('status').notNull().default('active'),
  departmentId: uuid('department_id'),
  routeType: text('route_type').notNull().default('person'),
  routeTarget: text('route_target'),
  routeAgentId: uuid('route_agent_id'),
  routeEscalateMode: text('route_escalate_mode').notNull().default('none'),
  routeEscalateTo: text('route_escalate_to'),
  routeEscalateAfter: integer('route_escalate_after').default(0),
  // Mirrored because the PBX decides whether to record, and a column missing
  // here fails the whole cache refresh with an error naming neither table nor
  // column — see the note at the top of this file.
  recordCalls: boolean('record_calls').notNull().default(false)
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
  domain: text('domain'),
  // Whose phone this is. Absent here — this is the control app's own trimmed
  // schema, not the web app's — selecting it handed drizzle an undefined column
  // and it failed inside Object.entries, which surfaced as "Cannot convert
  // undefined or null to object" and cost three wrong theories.
  meta: jsonb('meta')
});

// Minimal: membership links a user to a tenant and holds their PBX login
// (the SIP username we ring for department members). Option 1: one device/user.
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  pbxLogin: text('pbx_login')
});

// Minimal: the department itself. Only the name is needed here — the AI is told
// which teams exist and hands one back by name, so the cache needs to turn that
// name into an id. Its absence is what broke the refresh: a query against a
// table this schema didn't declare threw, and one catch around the whole refresh
// meant numbers and endpoints went with it.
// Minimal: enough to record how an OTP call actually ended. The row was marked
// delivered the moment the call was placed, so an unanswered number read the same
// as one where somebody heard the code — and delivery rate is what a client
// judges an OTP service by.
export const voiceOtps = pgTable('voice_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull().default('pending'),
  reason: text('reason')
});

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  description: text('description')
});

// Minimal: a user's membership in a department, with the can-take-calls flag.
export const departmentMembers = pgTable('department_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  canTakeCalls: boolean('can_take_calls').notNull().default(true)
});

export const connectFlows = pgTable('connect_flows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  telnum: text('telnum'),
  status: text('status').notNull().default('draft'),
  nodes: jsonb('nodes').$type<any[]>().notNull().default([])
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
  // Seconds a human spent on a call the AI handed over — duration stays the
  // whole conversation.
  agentSeconds: integer('agent_seconds'),
  user: text('user'),
  raw: jsonb('raw').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  callIdx: index('call_events_callid_idx').on(t.callid),
  uniqCall: uniqueIndex('call_events_tenant_callid_uidx').on(t.tenantId, t.callid)
}));
