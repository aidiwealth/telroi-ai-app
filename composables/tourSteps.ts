// composables/tourSteps.ts
// The step content for each tour. Targets reference [data-tour="key"] anchors.
// Steps with a `route` navigate there first (multi-page tours). Bump the version
// in the id (e.g. _v1 -> _v2) to re-show a tour after a meaningful change.
import type { TourStep } from './useTour';

export const CLIENT_TOUR_ID = 'client_v1';
export const ADMIN_TOUR_ID = 'admin_v1';

export const clientTour: TourStep[] = [
  { title: 'Welcome to Telroi', body: 'A quick 60-second tour of your workspace — calls, numbers, AI agents, billing and more. You can replay it anytime from the help menu.' },
  { target: 'nav-overview', title: 'Your overview', body: 'Live call volume, recent activity and account health at a glance. This is your home base.', route: '/', placement: 'right' },
  { target: 'nav-voice', title: 'Voice', body: 'Buy numbers, review call logs, set up SIP and manage your blacklist — everything telephony lives here.', placement: 'right' },
  { target: 'nav-ai', title: 'AI agents', body: 'Create AI Numbers that answer and route calls automatically, connect your own AI keys, and optimize how they respond.', placement: 'right' },
  { target: 'nav-crm', title: 'CRM', body: 'Your contacts and pipeline. Drag cards between stages on the board, and connect HubSpot, Pipedrive, Zoho or Zapier under Apps.', placement: 'right' },
  { target: 'nav-wallet', title: 'Wallet & billing', body: 'Top up, see your recurring monthly total and next charge. Calls and numbers bill from here in your local currency.', placement: 'right' },
  { target: 'topbar-dialer', title: 'Call customers fast', body: 'The dialer is your one-click way to call a customer right from the browser \u2014 punch in a number or pick a contact and connect in seconds, no separate phone needed.', placement: 'bottom' },
  { target: 'topbar-help', title: 'Help is always here', body: 'Replay this tour, reach support, or read the docs anytime from this menu. That\u2019s it \u2014 you\u2019re ready to go.', placement: 'bottom' }
];

export const adminTour: TourStep[] = [
  { title: 'Telroi Operator Console', body: 'A quick tour of the operator tools — clients, numbers, billing, pricing and platform settings. Replay anytime from the help menu.' },
  { target: 'nav-admin-overview', title: 'Platform overview', body: 'Live metrics across every workspace — call volume, revenue and system health.', route: '/admin', placement: 'right' },
  { target: 'nav-admin-clients', title: 'Clients', body: 'Create and manage client workspaces, set country and plan, manage their integrations and go-live.', placement: 'right' },
  { target: 'nav-admin-inventory', title: 'Number inventory', body: 'Add and assign numbers across carriers. Capacity and channels are tracked here and on Pricing.', placement: 'right' },
  { target: 'nav-admin-pricing', title: 'Pricing & billing ops', body: 'Set global rates and the single USD\u2192Naira exchange rate that drives all conversions. Run billing on demand.', placement: 'right' },
  { target: 'nav-admin-apps', title: 'App releases', body: 'Manage the native apps clients download \u2014 versions, links and availability \u2014 with no deploy needed.', placement: 'right' },
  { target: 'nav-admin-settings', title: 'Platform settings', body: 'Carrier credentials, voice providers, support numbers and emails. Configure once, applies platform-wide.', placement: 'right' }
];
