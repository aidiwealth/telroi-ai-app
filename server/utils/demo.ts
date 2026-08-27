/**
 * Sample data for the guided tour.
 *
 * The tour frames real pages, so a new client would otherwise be shown empty
 * tables — and an admin, who has no workspace of their own, would be shown a
 * login box. Neither teaches anything.
 *
 * So a page in the tour asks for ?demo=1 and gets a fixture instead. This runs
 * AFTER the endpoint's own auth check, so it is not a way in for anybody signed
 * out; it never writes; and it never touches the database, so no real row can
 * be read or changed through it.
 */
import type { H3Event } from 'h3';

export function wantsDemo(event: H3Event): boolean {
  return String(getQuery(event).demo || '') === '1';
}

/** Returns the fixture for `key` when the caller asked for the tour, else null. */
export function demoIfAsked(event: H3Event, key: keyof typeof FIXTURES) {
  if (!wantsDemo(event)) return null;
  return FIXTURES[key] ?? null;
}

const now = () => new Date();
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

/**
 * One imaginary workspace, consistent across every page: a Lagos food supplier
 * with two numbers, an agent, and a week of plausible traffic. The same names
 * and numbers recur so the tour reads as one business rather than several.
 */
const FIXTURES = {
  wallet: {
    balanceMinor: 4218000, currency: 'NGN', minTopupMinor: 1500000,
    postpaid: false, creditLimitMinor: 0, nextInvoiceAt: null,
    plan: 'growth', planFeeMinor: 2400000
  },

  ledger: {
    items: [
      { id: 'd1', kind: 'debit',  reason: 'voice_minute', amountMinor: 3820,
        balanceAfterMinor: 4218000, createdAt: ago(48), sandbox: false,
        meta: { seconds: 142, source: 'inbound', currency: 'NGN' } },
      { id: 'd2', kind: 'debit',  reason: 'ai_managed', amountMinor: 9650,
        balanceAfterMinor: 4221820, createdAt: ago(48), sandbox: false,
        meta: { turns: 6, sttSeconds: 41, currency: 'NGN' } },
      { id: 'd3', kind: 'credit', reason: 'topup', amountMinor: 5000000,
        balanceAfterMinor: 4231470, createdAt: ago(1180), sandbox: false,
        meta: { provider: 'monnify', currency: 'NGN' } },
      { id: 'd4', kind: 'debit',  reason: 'number_monthly', amountMinor: 200000,
        balanceAfterMinor: 3994000, createdAt: ago(7200), sandbox: false,
        meta: { telnum: '+2341700441 2', channels: 2, currency: 'NGN' } }
    ],
    total: 4, page: 1, pages: 1
  },

  numbers: {
    numbers: [
      { id: 'n1', telnum: '+2341700 4412', country: 'NG', region: 'Lagos',
        provider: 'ruach', status: 'active', routeType: 'ai', routeLabel: 'Bisi',
        recordCalls: true, monthlyMinor: 200000 },
      { id: 'n2', telnum: '+2341700 4413', country: 'NG', region: 'Lagos',
        provider: 'ruach', status: 'active', routeType: 'department',
        routeLabel: 'Sales', recordCalls: false, monthlyMinor: 200000 }
    ]
  },

  goLive: {
    live: true, approved: true, complianceStatus: 'approved',
    planSelected: true, eligible: false, blockedReason: null,
    sandbox: { active: false }, trial: null, demoNumber: '+234 700 555 0180'
  },

  calls: {
    calls: [
      { uid: 'g1', type: 'in',  status: 'completed', client: '+234 802 701 6644',
        contactName: 'Chidi Okonkwo', user: 'Bisi (AI)', duration: 142, wait: 2,
        start: ago(48), costMinor: 13470, recording: true, escalatedUnanswered: false },
      { uid: 'g2', type: 'in',  status: 'completed', client: '+234 809 445 1120',
        contactName: null, user: null, duration: 48, wait: 40,
        start: ago(60), costMinor: 2840, recording: true, escalatedUnanswered: true },
      { uid: 'g3', type: 'out', status: 'completed', client: '+234 701 220 8890',
        contactName: 'Bilkisu Yaro', user: 'Kunle Bakare', duration: 250, wait: 0,
        start: ago(1500), costMinor: 24010, recording: false, escalatedUnanswered: false },
      { uid: 'g4', type: 'in',  status: 'completed', client: '+1 408 667 0965',
        contactName: null, user: 'Bisi (AI)', duration: 66, wait: 1,
        start: ago(1600), costMinor: 9200, recording: true, escalatedUnanswered: false }
    ]
  },

  contacts: {
    contacts: [
      { id: 'c1', name: 'Chidi Okonkwo', phone: '+2348027016644', status: 'customer',
        callCount: 7, lastCallAt: ago(48),
        note: 'Wants a weekly standing order for Ikeja. Kunle to quote Monday.' },
      { id: 'c2', name: 'Bilkisu Yaro', phone: '+2347012208890', status: 'customer',
        callCount: 3, lastCallAt: ago(1500), note: 'Prefers a call before delivery.' },
      { id: 'c3', name: null, phone: '+2348094451120', status: 'lead',
        callCount: 1, lastCallAt: ago(60), note: null }
    ],
    total: 3, page: 1, pages: 1
  },

  people: {
    people: [
      { id: 'p1', name: 'Tunde Adeyemi', email: 'tunde@example.com', role: 'owner',
        status: 'active', teams: ['Sales', 'Support'] },
      { id: 'p2', name: 'Ngozi Eze', email: 'ngozi@example.com', role: 'admin',
        status: 'active', teams: ['Support'] },
      { id: 'p3', name: 'Kunle Bakare', email: 'kunle@example.com', role: 'member',
        status: 'invited', teams: ['Sales'] }
    ]
  },

  agents: {
    agents: [
      { id: 'a1', name: 'Bisi', status: 'live', voice: 'Amara',
        telnum: '+2341700 4412', callsThisMonth: 142, spentMinor: 894000 },
      { id: 'a2', name: 'After-hours', status: 'draft', voice: 'Amara',
        telnum: null, callsThisMonth: 0, spentMinor: 0 }
    ]
  }
};
