// Seeds one tenant + owner so the app runs locally against the mock.
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';
import { createCipheriv, randomBytes } from 'node:crypto';

const url = process.env.DATABASE_URL;
const encKey = process.env.ENCRYPTION_KEY;
if (!url || !encKey) { console.error('DATABASE_URL and ENCRYPTION_KEY required'); process.exit(1); }

function enc(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(encKey!, 'base64'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema });

const [tenant] = await db.insert(schema.tenants).values({
  name: 'Acme Demo', slug: 'acme', timezone: 'Europe/Berlin',
  country: 'United States', sector: 'Technology / SaaS', businessPhone: '+14155550100',
  telroiDomain: 'mock.local', telroiApiKeyEnc: enc('mock-crm-token-123'),
  widgetKey: 'wgt_demo0000000000000000000000000',
  onboardingStep: 5
}).returning();

const [user] = await db.insert(schema.users).values({ email: 'owner@acme.test', name: 'Demo Owner' }).returning();
await db.insert(schema.memberships).values({ userId: user.id, tenantId: tenant.id, role: 'owner' });

// A second member (role 'member') to demonstrate department capability gating.
const [agent] = await db.insert(schema.users).values({ email: 'agent@acme.test', name: 'Demo Agent' }).returning();
await db.insert(schema.memberships).values({ userId: agent.id, tenantId: tenant.id, role: 'member' });

// Platform admin (operator console at /admin) + operator settings for local dev.
await db.insert(schema.platformAdmins).values({ email: 'boss@telroi.ai', role: 'superadmin' });
await db.insert(schema.platformSettings).values({
  id: 'singleton',
  operatorDomain: 'mock.local',
  operatorApiKeyEnc: enc('mock-operator-key'),
  clientDomainSuffix: 'digitaltide.io'
});

console.log('✓ seeded tenant acme + owner@acme.test');
console.log('✓ seeded platform admin boss@telroi.ai (operator console at /admin/login)');

// Pricing config (real rates from the marketing site) + a funded demo wallet.
await db.insert(schema.pricing).values({
  id: 'singleton',
  voiceMinuteUsdMinor: 1, channelMonthlyUsdMinor: 200, didMonthlyUsdMinor: 170,
  planStartupUsdMinor: 1000, planGrowthUsdMinor: 1500, ngnPerUsd: 1600
});
const [wallet] = await db.insert(schema.wallets).values({
  tenantId: tenant.id, currency: 'USD', balanceMinor: 5000, plan: 'growth' // $50.00 demo balance
}).returning();
await db.insert(schema.ledger).values({
  walletId: wallet.id, tenantId: tenant.id, kind: 'credit',
  amountMinor: 5000, balanceAfterMinor: 5000, reason: 'topup', reference: 'seed_demo'
});
console.log('✓ seeded pricing + funded demo wallet ($50.00)');

// Native-app download catalog (the Apps tab renders this).
await db.insert(schema.appReleases).values([
  { platform: 'ios', name: 'Telroi for iOS', description: 'Make and take calls on your iPhone.', groupLabel: 'Mobile', iconKey: 'apple', accent: '#0A0A0B', version: '1.0.0', downloadUrl: 'https://apps.apple.com/app/telroi', requirement: 'iOS 15+', fileSize: '48 MB', status: 'available', sortOrder: 1 },
  { platform: 'android', name: 'Telroi for Android', description: 'Calls, contacts and notifications on Android.', groupLabel: 'Mobile', iconKey: 'android', accent: '#1A7A4F', version: '1.0.0', downloadUrl: 'https://play.google.com/store/apps/details?id=ai.telroi', requirement: 'Android 9+', fileSize: '36 MB', status: 'available', sortOrder: 2 },
  { platform: 'mac', name: 'Telroi for Mac', description: 'A focused desktop dialer for macOS.', groupLabel: 'Desktop', iconKey: 'apple', accent: '#0A0A0B', version: '1.0.0', downloadUrl: 'https://dl.telroi.ai/mac', requirement: 'macOS 12+', fileSize: '72 MB', status: 'coming_soon', sortOrder: 3 },
  { platform: 'windows', name: 'Telroi for Windows', description: 'The full calling workspace on Windows.', groupLabel: 'Desktop', iconKey: 'windows', accent: '#1A4B72', version: '1.0.0', downloadUrl: 'https://dl.telroi.ai/windows', requirement: 'Windows 10+', fileSize: '88 MB', status: 'coming_soon', sortOrder: 4 }
]).onConflictDoNothing();
console.log('✓ seeded app-release catalog (iOS, Android, Mac, Windows)');

// Status page: components are PREDETERMINED in code (status-registry.ts) and
// auto-tracked by the probe scheduler. We only seed the admin-editable rows
// (description + sort order) so the page has labels before the first probe runs.
await db.insert(schema.statusComponents).values([
  { key: 'dashboard_api', description: 'Web dashboard and REST API', sortOrder: 1 },
  { key: 'voice_otp', description: 'One-time passcode delivery over voice', sortOrder: 2 },
  { key: 'speech', description: 'Text-to-speech & speech-to-text', sortOrder: 3 },
  { key: 'voice_calls', description: 'Outbound & inbound call origination', sortOrder: 4 },
  { key: 'numbers', description: 'Phone number management', sortOrder: 5 },
  { key: 'webhooks', description: 'Event delivery to your endpoints', sortOrder: 6 }
]).onConflictDoNothing();
console.log('✓ seeded status component descriptions (status auto-tracked by probes)');

// Demo number inventory so the buy flow has numbers to show.
await db.insert(schema.numberInventory).values([
  { telnum: '+2348012340003', region: 'NG', provider: 'telroi', status: 'available' },
  { telnum: '+14155550102', region: 'US', provider: 'twilio', status: 'available' },
  { telnum: '+14155550103', region: 'US', provider: 'telnyx', status: 'available' },
  { telnum: '+447700900101', region: 'GB', provider: 'twilio', status: 'available' }
]).onConflictDoNothing();
console.log('✓ seeded demo number inventory (NG, US, GB)');

// Two active number subscriptions for the demo tenant so Teams + the dialer's
// "Call from" list have real numbers to work with.
const [subA, subB] = await db.insert(schema.numberSubscriptions).values([
  { tenantId: tenant.id, telnum: '+14155550101', region: 'US', provider: 'twilio', channels: 2, status: 'active', nextBillingAt: new Date(Date.now() + 30 * 864e5) },
  { tenantId: tenant.id, telnum: '+2348012340001', region: 'NG', provider: 'telroi', channels: 1, status: 'active', nextBillingAt: new Date(Date.now() + 30 * 864e5) }
]).returning();

// A demo "Sales" department: the agent is a member (can make + take calls),
// and one number is assigned to it — so permission gating is demonstrable.
const [dept] = await db.insert(schema.departments).values({
  tenantId: tenant.id, name: 'Sales', description: 'Outbound sales team'
}).returning();
await db.insert(schema.departmentMembers).values({
  departmentId: dept.id, tenantId: tenant.id, userId: agent.id,
  canMakeCalls: true, canTakeCalls: true, canOperate: false
});
await db.update(schema.numberSubscriptions).set({ departmentId: dept.id }).where(eq(schema.numberSubscriptions.id, subA.id));
console.log('✓ seeded Sales department (agent@acme.test member) + 2 active numbers');

// Demo CRM contacts (Telroi One) so the CRM has data to show on the demo tenant.
await db.insert(schema.crmContacts).values([
  { tenantId: tenant.id, name: 'Ada Obi', company: 'Brightpay', email: 'ada@brightpay.io', phone: '+2348030001111', city: 'Lagos', country: 'Nigeria', status: 'customer', source: 'manual' },
  { tenantId: tenant.id, name: 'James Carter', company: 'Northwind', email: 'james@northwind.co', phone: '+14155551234', city: 'San Francisco', country: 'United States', status: 'lead', source: 'Direct' },
  { tenantId: tenant.id, name: 'Priya Shah', company: 'Lumen Health', phone: '+447700900456', city: 'London', country: 'United Kingdom', status: 'active', source: 'API' },
  { tenantId: tenant.id, name: 'Tunde Bello', company: 'Paystack reseller', phone: '+2348030002222', city: 'Abuja', country: 'Nigeria', status: 'lead', source: 'SIP' },
  { tenantId: tenant.id, name: 'Grace Lin', company: 'Meridian', phone: '+14155559876', city: 'Oakland', country: 'United States', status: 'churned', source: 'google' }
]).onConflictDoNothing();
console.log('✓ seeded 5 demo CRM contacts (manual, Direct, API, SIP, google)');

// Demo Live Call sessions (for map + CSAT metrics).
await db.insert(schema.liveCallSessions).values([
  { tenantId: tenant.id, visitorName: 'Web Visitor', visitorPhone: '+14155550201', visitorType: 'visitor', city: 'San Francisco', country: 'United States', lat: '37.77', lng: '-122.42', status: 'ended', outcome: 'answered', routedTo: 'agent', handledByLabel: 'Sales', csatScore: 5, csatComment: 'Quick and helpful, thank you!' },
  { tenantId: tenant.id, visitorName: 'Logged-in User', visitorPhone: '+2348030003333', visitorType: 'user', externalUserId: 'usr_123', city: 'Lagos', country: 'Nigeria', lat: '6.52', lng: '3.37', status: 'ended', outcome: 'answered', routedTo: 'ai', handledByLabel: 'AI agent', csatScore: 4, csatComment: 'The assistant understood me well.' },
  { tenantId: tenant.id, visitorName: 'Jane D', visitorPhone: '+447700900789', visitorType: 'visitor', city: 'London', country: 'United Kingdom', lat: '51.51', lng: '-0.13', status: 'ended', outcome: 'answered', routedTo: 'agent', handledByLabel: 'Sales', csatScore: 5 },
  { tenantId: tenant.id, visitorName: 'Missed Caller', visitorPhone: '+14155550299', visitorType: 'visitor', city: 'Austin', country: 'United States', lat: '30.27', lng: '-97.74', status: 'ended', outcome: 'failed', routedTo: 'agent', handledByLabel: 'Sales', csatScore: 2, csatComment: 'Could not get through the first time.' }
]).onConflictDoNothing();
console.log('✓ seeded 4 demo Live Call sessions (with CSAT + outcomes)');

// Seed the plan feature catalog (inlined to avoid pulling Nitro runtime utils).
const FEATURES = [
  { key: 'van', label: 'AI call answering (VAN)', startup: true, growth: true, custom: true },
  { key: 'recording', label: 'Call recording & transcription', startup: true, growth: true, custom: true },
  { key: 'api', label: 'Webhooks & API access', startup: true, growth: true, custom: true },
  { key: 'optimize', label: 'Route scoring & fraud detection', startup: true, growth: true, custom: true },
  { key: 'routing', label: 'CLI-compliant voice routing', startup: true, growth: true, custom: true },
  { key: 'numbers', label: 'DID number provisioning', startup: true, growth: true, custom: true },
  { key: 'multilang', label: 'Multi-language AI support', startup: true, growth: true, custom: true },
  { key: 'crm', label: 'Telroi CRM — contacts, deals, call logs', startup: false, growth: true, custom: true },
  { key: 'live_call', label: 'Live Call — website & app call widget', startup: false, growth: true, custom: true },
  { key: 'apps', label: 'Apps & Integrations', startup: false, growth: true, custom: true },
  { key: 'dialer', label: 'Desktop dialer (Mac & Windows)', startup: false, growth: true, custom: true },
  { key: 'messenger', label: 'Team messenger', startup: false, growth: true, custom: true },
  { key: 'subdomain', label: 'yourcompany.telroi.ai subdomain', startup: false, growth: true, custom: true },
  { key: 'summaries', label: 'AI call summaries to CRM', startup: false, growth: true, custom: true },
  { key: 'team', label: 'Admin controls & user management', startup: false, growth: true, custom: true },
  { key: 'priority', label: 'Priority support', startup: false, growth: true, custom: true },
  { key: 'onboarding', label: 'Custom onboarding', startup: false, growth: false, custom: true },
  { key: 'compliance_support', label: 'Dedicated compliance support', startup: false, growth: false, custom: true },
  { key: 'whitelabel', label: 'White-label & on-prem options', startup: false, growth: false, custom: true }
];
await db.insert(schema.planFeatures).values(FEATURES).onConflictDoNothing();
console.log('✓ seeded plan feature catalog');

// ── Telroi Support workspace + related demo content ──
// Telroi dogfoods its own platform: a 'Telroi Support' workspace receives the
// support widget's calls. We seed it with contacts/sessions that RELATE to the
// client demo above — e.g. the demo client's owner reaching out to Telroi
// support — so the admin CRM + Live Call console show a coherent story, not
// random data.
const [supportTenant] = await db.insert(schema.tenants).values({
  name: 'Telroi Support', slug: 'telroi-support', plan: 'growth', isInternal: true,
  onboardingStep: 5, widgetKey: 'wgt_support00000000000000000000000'
}).onConflictDoNothing().returning();

if (supportTenant) {
  await db.update(schema.platformSettings).set({
    supportTenantId: supportTenant.id,
    supportTelnum: '+2348000000001',
    supportNumbersByRegion: { NG: '+2348000000001', INTL: '+14155550110' }
  }).where(eq(schema.platformSettings.id, 'singleton'));
  await db.insert(schema.wallets).values({ tenantId: supportTenant.id, currency: 'USD', balanceMinor: 10000, plan: 'growth' }).onConflictDoNothing();

  // Support CRM contacts — these are Telroi's OWN customers (the client above is one).
  await db.insert(schema.crmContacts).values([
    { tenantId: supportTenant.id, name: 'Demo Owner (Acme)', company: 'Acme Demo', phone: '+14155550100', email: 'owner@acme.test', status: 'customer', source: 'web_call', city: 'San Francisco', country: 'United States' },
    { tenantId: supportTenant.id, name: 'Prospect — Lagos SaaS', company: 'Naija Cloud', phone: '+2348030001111', email: 'cto@naijacloud.io', status: 'lead', source: 'web_call', city: 'Lagos', country: 'Nigeria' },
    { tenantId: supportTenant.id, name: 'Trial user', company: 'Kano Logistics', phone: '+2348030002222', status: 'lead', source: 'web_call', city: 'Kano', country: 'Nigeria' }
  ]).onConflictDoNothing();

  // Support Live Call sessions — customers reaching Telroi's own support widget.
  await db.insert(schema.liveCallSessions).values([
    { tenantId: supportTenant.id, visitorName: 'Demo Owner (Acme)', visitorPhone: '+14155550100', visitorType: 'user', externalUserId: 'acme-owner', city: 'San Francisco', country: 'United States', lat: '37.77', lng: '-122.42', status: 'ended', outcome: 'answered', routedTo: 'agent', handledByLabel: 'Support team', csatScore: 5, csatComment: 'Helped me set up my Live Call widget.' },
    { tenantId: supportTenant.id, visitorName: 'Prospect — Lagos SaaS', visitorPhone: '+2348030001111', visitorType: 'visitor', city: 'Lagos', country: 'Nigeria', lat: '6.52', lng: '3.37', status: 'ended', outcome: 'answered', routedTo: 'ai', handledByLabel: 'AI agent', csatScore: 4, csatComment: 'Quick answers about pricing in Naira.' }
  ]).onConflictDoNothing();
  console.log('✓ seeded Telroi Support workspace + related demo CRM/Live Call content');

  // Support's own AI virtual number infrastructure: a number, an AI agent, and
  // a live VAN — so Telroi runs its own support line on the same VAN system.
  await db.insert(schema.numberSubscriptions).values({
    tenantId: supportTenant.id, telnum: '+2348000000001', region: 'NG', provider: 'telroi', status: 'active',
    channels: 2, nextBillingAt: new Date(Date.now() + 30 * 864e5)
  }).onConflictDoNothing();
  const [supportAgent] = await db.insert(schema.aiAgents).values({
    tenantId: supportTenant.id, name: 'Telroi Support AI', greeting: 'Hi, this is Telroi support — how can I help?',
    systemPrompt: 'You are Telroi’s support assistant. Help with onboarding, billing, and Live Call setup. Escalate to a human on request.'
  }).returning();
  if (supportAgent) {
    await db.insert(schema.vans).values({
      tenantId: supportTenant.id, name: 'Telroi Support Line', telnum: '+2348000000001', provider: 'telroi',
      agentId: supportAgent.id, languages: ['en'], escalateTo: 'Support team', escalateAfter: 0, status: 'live'
    }).onConflictDoNothing();
  }

  // International support line: a US number on Telnyx + its own VAN, so the SAME
  // support Live Call widget answers non-Nigerian callers with the right carrier.
  // (Location-based routing in the widget picks NG vs international automatically.)
  await db.insert(schema.numberSubscriptions).values({
    tenantId: supportTenant.id, telnum: '+14155550110', region: 'US', provider: 'telnyx', status: 'active',
    channels: 2, nextBillingAt: new Date(Date.now() + 30 * 864e5)
  }).onConflictDoNothing();
  if (supportAgent) {
    await db.insert(schema.vans).values({
      tenantId: supportTenant.id, name: 'Telroi Support Line (International)', telnum: '+14155550110', provider: 'telnyx',
      agentId: supportAgent.id, languages: ['en'], escalateTo: 'Support team', escalateAfter: 0, status: 'live'
    }).onConflictDoNothing();
  }
  // A live AI call in progress (so the takeover panel has something to show).
  const [liveAiSession] = await db.insert(schema.liveCallSessions).values({
    tenantId: supportTenant.id, visitorName: 'Incoming — Abuja Fintech', visitorPhone: '+2348030004444',
    visitorType: 'visitor', city: 'Abuja', country: 'Nigeria', lat: '9.07', lng: '7.49',
    status: 'connected', routedTo: 'ai', handledByLabel: 'Telroi Support AI'
  }).returning();
  if (liveAiSession) {
    await db.insert(schema.callEvents).values({
      tenantId: supportTenant.id, callid: `lc_${liveAiSession.id}`, direction: 'in', phone: '+2348030004444',
      status: 'connected', carrier: 'telroi', handledBy: 'ai', startedAt: new Date()
    }).onConflictDoNothing();
  }
  console.log('✓ seeded support AI number infrastructure (agent + live VAN + active AI call)');
}

await sql.end();
