/**
 * A walkthrough of the platform, from the front page to a live call.
 *
 * Deliberately not tied to the caller's workspace: the setup panel in their
 * sidebar already tracks what they have done. This is the tour — the same for a
 * new client, an established one, or an admin showing a prospect, which is also
 * what lets an admin open it at all.
 */
export interface TourStep {
  id: string;
  t: string;
  lede: string;
  /** Where the frame points. External pages open rather than embed. */
  src?: string;
  to?: string;
  ext?: string;
  body: string[];
  watch?: string;
  know?: string[];
  n?: number;
  g?: string;
}

export const TOUR: { g: string; items: TourStep[] }[] = [
  { g: 'Welcome to Telroi', items: [
    {
      id: 'front', t: 'What Telroi is',
      src: 'https://telroi.ai',
      lede: 'Phone numbers your business can answer three ways: a person, a team, or an AI agent that picks up when nobody is free.',
      body: [
        'Everything runs in the browser &mdash; no handsets to buy, no lines to install, no engineer to book.',
        'You pay for what you use from a prepaid wallet, so there is no contract to escape and no bill you did not expect.',
        'The same number can be answered by a person today and an agent tomorrow. Nothing is wired in.'
      ],
      know: ['Numbers available across Nigeria and internationally',
             'One workspace holds your numbers, team, call history and money']
    },
    {
      id: 'login', t: 'Signing in',
      src: '/login',
      lede: 'There are no passwords. You enter your email, we send a six-digit code, and that is the sign-in.',
      body: [
        'Type your work email. If your company has a domain, use it &mdash; colleagues joining later are easier to recognise.',
        'A code arrives in a few seconds. It is single-use and expires in minutes.',
        'Type it back and you are in. The session lasts a week, so daily use needs no sign-in.'
      ],
      watch: 'A code that never arrives is almost always a spam filter. Adding Telroi to your safe senders once solves it for the whole team.',
      know: ['Nothing to invent, store, or leak in somebody else&rsquo;s breach',
             'Removing an email removes that person&rsquo;s access immediately']
    },
    {
      id: 'workspace', t: 'Your workspace',
      src: '/settings',
      lede: 'The workspace holds everything. A few details here decide what the rest of the platform can do.',
      body: [
        'Your business name appears on invoices and to anyone you invite.',
        'Your country decides which numbers you can buy, which compliance rules apply, and whether your wallet is in Naira or dollars.',
        'Your timezone drives your call history and your daily AI limit.'
      ],
      watch: 'Country is hard to change later &mdash; numbers, carriers, currency and compliance all follow from it. Set it to where the business actually operates.',
      know: ['New workspaces start in sandbox: everything works, nothing is charged',
             'Operating in two countries usually means two workspaces']
    }
  ]},

  { g: 'Going live', items: [
    {
      id: 'wallet', t: 'Funding your wallet',
      src: '/wallet',
      lede: 'Telroi is prepaid. Calls, numbers and AI draw from a wallet, so no invoice arrives at month end and no direct debit runs against your account.',
      body: [
        '<b>Bank transfer</b> &mdash; your workspace gets its own dedicated account number, permanently. Transfer to it from your bank and the balance moves on its own: no reference to quote, nothing to send us. Cheaper, and better for the amount you would put in at the start of a month.',
        '<b>Card</b> &mdash; lands in seconds. Best for topping up mid-day, or a small first amount while testing.',
        'Every movement is on your statement with what it was for. A call charge shows the seconds and the direction, so a figure you do not recognise traces back to the call that caused it.'
      ],
      watch: 'Your bank tells us the money arrived, not the payment page &mdash; so the balance can lag a few seconds behind. Refresh before assuming it failed.',
      know: ['Minimum &#8358;15,000 by transfer, or $10 outside Nigeria',
             'Keep roughly a week of usage as a buffer',
             'Anything left in the wallet stays there if you stop using Telroi']
    },
    {
      id: 'compliance', t: 'Passing compliance',
      src: '/settings',
      lede: 'Before a real number can be issued, regulators require that it traces to an identified business. What is asked for depends on where you are.',
      body: [
        '<b>In Nigeria</b> the NCC requires a <b>NIN</b> for an individual, or a <b>CAC registration</b> for a company, plus proof of address &mdash; and a signed <b>NCC undertaking</b> confirming the numbers will not be used for fraud, unsolicited marketing or impersonation.',
        '<b>Internationally</b> it is usually a business registration and proof of address. Some countries additionally require a local address for certain number ranges.',
        'Review takes a working day or two, and you can see the status throughout.'
      ],
      watch: 'Start this first. It runs in the background while you build everything else, so beginning it early costs nothing and saves you a wait.',
      know: ['A demo number works throughout, so nothing is blocked',
             'The page asks only for what your country and number type need']
    }
  ]},

  { g: 'Your first number', items: [
    {
      id: 'numbers', t: 'Claiming a number',
      src: '/numbers',
      lede: 'A number is what customers dial. What happens after they dial it is entirely yours to decide, and can change whenever you like.',
      body: [
        'Search by country and area. Nigerian numbers come from several carriers; international numbers from our global ones.',
        'Say what the number will be used for. This is not a formality &mdash; see below.',
        'Confirm. The monthly fee comes from your wallet and the number is live within a minute or two.'
      ],
      watch: 'Six uses carry regulatory weight &mdash; <b>authentication, financial, health, emergency, government and outbound campaigns</b>. Choosing one shows a short indemnity agreement before purchase, and we record which version you accepted, against your name and that number. A one-time password line used for fraud is a serious matter for the carrier as well as for you.',
      know: ['A number bills monthly from your wallet',
             'Recording is set per number and off unless you turn it on',
             'When recording is on, callers hear a notice first &mdash; that is not optional']
    },
    {
      id: 'routing', t: 'Setting up routing',
      src: '/numbers',
      lede: 'Open a number and choose what happens when it rings. Four options, and changes take effect on the next call.',
      body: [
        '<b>One person</b> &mdash; a direct line, ringing wherever they are signed in.',
        '<b>A team</b> &mdash; everyone in a department rings at once, and the first to answer takes the call while the rest stop ringing.',
        '<b>An AI agent</b> &mdash; it answers, handles what it can, and fetches a person when it should.',
        '<b>A Connect flow</b> &mdash; a menu or sequence you design yourself.',
        'Then set the <b>escalation</b>: where the call goes if nobody picks up. Without it, a missed call goes to silence.'
      ],
      know: ['Most businesses start with a team and add an agent once they see when calls arrive',
             'A number with no escalation rings out to voicemail']
    },
    {
      id: 'tab', t: 'Why your browser tab must stay open',
      src: '/',
      lede: 'The single most important thing to tell a new team, and the most common cause of &ldquo;our number does not work&rdquo;.',
      body: [
        'Browser calling works only while Telroi is open. <b>A closed tab is an unplugged phone</b> &mdash; the call rings, nobody answers, and the caller hears your unavailable message.',
        'The tab can sit in the background and the laptop can be doing anything else. It just has to exist. In practice: pin Telroi the way you would leave a desk phone plugged in.',
        'If that does not fit how your team works, there are two ways round it: sign in on the mobile app, which removes the dependency entirely, or set an AI agent as the first answer with an escalation to a mobile number.'
      ],
      watch: 'Tell your team this on day one. Every other explanation for a number that seems dead turns out to be this one.',
      know: ['The mobile app rings whether or not a browser is open',
             'An agent answering first means nobody reaches silence']
    }
  ]},

  { g: 'Unlocking Telroi AI', items: [
    {
      id: 'van', t: 'Setting up an AI number',
      src: '/vans',
      lede: 'An agent answers the phone, holds a conversation, and hands over to a person when it should. It is the part of Telroi that changes how a small team handles volume.',
      body: [
        'Give it a name and a voice. Callers hear the name in the greeting, so pick something that suits the business.',
        'Write its instructions &mdash; what you sell, how you answer common questions, what it must never promise. This is the part worth real time.',
        'Set when it hands over: usually when the caller asks, when it does not know, or after a couple of unhelpful exchanges.',
        'A <b>Virtual AI Number</b> is a number whose only job is to reach an agent &mdash; no team behind it. Useful for an order line, a booking line, or a campaign line you want to measure on its own.'
      ],
      know: ['Test by calling your demo number and saying the awkward things a customer would',
             'A draft agent costs nothing until it answers a call',
             'A daily limit stops the AI once reached &mdash; calls go to your team instead']
    },
    {
      id: 'aikeys', t: 'Managed AI, or your own keys',
      src: '/ai',
      lede: 'The intelligence behind an agent &mdash; hearing speech, deciding what to say, speaking it aloud &mdash; comes from specialist providers. You can let us handle that, or bring your own accounts.',
      body: [
        '<b>Managed</b> means we provide everything and you pay Telroi per conversation. One bill, no accounts to open, nothing to maintain. Right for almost everyone, and the only sensible way to start.',
        '<b>Your own keys</b> means connecting your provider accounts and paying them directly. Worth it at high volume, or where your organisation has negotiated rates or a data-residency requirement.',
        'Switching later changes nothing about your agents &mdash; they behave identically either way.'
      ],
      know: ['Start managed and revisit when volume makes it worth the admin',
             'Spend per agent is visible, so you can see which line is busy']
    },
    {
      id: 'prompt', t: 'Writing instructions that cost less',
      src: '/vans',
      lede: 'AI is charged by how much the agent hears and says. Well-written instructions cost less and work better, because the thing that makes an agent expensive is the same thing that makes it unhelpful: rambling.',
      body: [
        '<b>Be specific about scope.</b> &ldquo;You answer questions about delivery times, opening hours and order status. For anything else, offer to fetch a colleague.&rdquo; An agent that knows its limits stops sooner.',
        '<b>Ask for short answers.</b> &ldquo;One or two sentences unless asked for detail.&rdquo; Callers prefer it and it costs less.',
        '<b>Give real answers, not topics.</b> &ldquo;Delivery in Lagos is next day&rdquo; beats &ldquo;you can answer delivery questions&rdquo; &mdash; which invites the agent to invent something.',
        '<b>Say what it must never do.</b> Never quote a price it has not been given. Never promise a refund. Never confirm anything about an account it cannot see.',
        '<b>Hand over early rather than late.</b> A caller transferred after thirty seconds is happier than one transferred after four minutes of getting nowhere &mdash; and it is cheaper.'
      ],
      watch: 'The daily spend limit is your safety rail. When it is reached the AI stops answering and calls go to your team, so nobody is turned away and an unusual day cannot drain the wallet.',
      know: ['You can set your own limit lower than the default',
             'Read a transcript when a call goes badly &mdash; it usually shows which instruction was missing']
    }
  ]},

  { g: 'Your team and customers', items: [
    {
      id: 'people', t: 'Inviting people, and what they can do',
      src: '/people',
      lede: 'Adding somebody takes seconds. Deciding what each of them can do takes a moment and saves awkwardness later.',
      body: [
        'Invite by email. They sign in with a code the same way you did &mdash; nothing for you to communicate securely, and no password to set.',
        '<b>Owner</b> can do everything, including the plan, invoices and closing the workspace.',
        '<b>Admin</b> can buy numbers, change routing, build agents, invite people and top up the wallet &mdash; but not change the plan or see invoices.',
        '<b>Member</b> can make and take calls and use the CRM, but cannot see the wallet or change how calls are routed.',
        'Most people should be members. Give admin to whoever actually looks after the phone setup, and keep owner to yourself and perhaps one other.'
      ],
      know: ['Removing somebody ends their access immediately, including an open session',
             'Their call history and notes stay with the workspace']
    },
    {
      id: 'teams', t: 'Teams that ring together',
      src: '/teams',
      lede: 'A team is a group that rings at once. Put three salespeople in a Sales team, point a number at it, and all three ring &mdash; first to answer takes the call.',
      body: [
        'Somebody can belong to more than one team. A small business often has everyone in everything, which is fine and worth revisiting as you grow.',
        'A number can ring a team directly, or an agent can hand over to one when it needs a person.',
        'Set what happens if the team does not answer &mdash; another team, a mobile number, or voicemail.'
      ],
      know: ['Teams decide who rings together, not what anybody can see',
             'Changing a team takes effect on the next call']
    },
    {
      id: 'calls', t: 'Call history and recordings',
      src: '/calls',
      lede: 'Every call in and out, with who it was, how long it lasted, who dealt with it and what it cost.',
      body: [
        'Open any call for the detail: play the recording if the number records, read a transcript, add a note, or jump to that person&rsquo;s contact record.',
        'Recording is per number and off by default. When it is on, callers hear a notice before the call connects &mdash; that is a legal requirement in most places.',
        'Recordings are kept for a limited period and then deleted automatically. A transcript you have asked for is kept, since it is much smaller and often the reason you recorded.'
      ],
      watch: 'The row worth watching is a caller who asked for a person and did not get one. When an agent answers everything, a plain missed-call count always reads zero however many people gave up waiting.',
      know: ['Transcription is charged by the length of the audio',
             'Export gives you the same data as a spreadsheet']
    },
    {
      id: 'crm', t: 'Contacts build themselves',
      src: '/crm',
      lede: 'Anybody who calls you, or who you call, becomes a contact automatically. You never import a list.',
      body: [
        'Open a contact and you see every call you have ever had with them, in order, with your notes against each.',
        'Numbers are matched intelligently, so the same person arriving as 08027016644 one day and +2348027016644 another stays one contact rather than becoming two.',
        'Notes are visible to the whole team, so a colleague picking up next time knows what was said last time.'
      ],
      know: ['A caller with no name is still a contact &mdash; name them when you learn it',
             'Contacts and their notes survive somebody leaving the team']
    }
  ]},

  { g: 'Advanced routing', items: [
    {
      id: 'connect', t: 'Building a Connect flow',
      src: '/connect',
      lede: 'A Connect flow is a call path you draw. Instead of a number ringing one place, it can play a greeting, offer a menu, check the time of day, and send the caller somewhere different depending on what they choose.',
      body: [
        '<b>A menu.</b> Press 1 for sales, 2 for support, 3 for accounts &mdash; each going to a different team.',
        '<b>Opening hours.</b> During the day, ring the team. Outside it, the agent answers or the caller leaves a message.',
        '<b>Triage.</b> The agent answers everything, works out what is needed, and transfers to the right team rather than making the caller choose from a menu.',
        'Flows are built by dragging steps together, and you can test one against your demo number before pointing a real number at it.'
      ],
      watch: 'Three options is plenty. Every extra layer is a customer wondering whether to hang up and call a competitor. If you find yourself designing the fourth level, an agent that simply asks what they need is usually the better answer.',
      know: ['A published flow takes effect on the next call',
             'Any branch can end at a person, a team, an agent or voicemail']
    },
    {
      id: 'live', t: 'The Live Call widget',
      src: '/live-call',
      lede: 'A button on your website that lets a visitor talk to you without dialling anything. They click, you get a call, and it rings your team exactly like a phone call &mdash; because it is one.',
      body: [
        'Choose where it rings: a team, a person, or your AI agent.',
        'Copy the snippet &mdash; one line of code. Your web developer pastes it into your site, or you paste it into the custom code box in your site builder.',
        'Click it yourself from your own site as a visitor would, and make sure it reaches the right place.'
      ],
      know: ['Visitors need no account, no app and no phone number',
             'It appears in your call log alongside everything else',
             'Charged like a normal call']
    },
    {
      id: 'apps', t: 'Connecting other tools',
      src: '/apps',
      lede: 'Telroi does not have to be where the work ends. Calls, contacts and recordings can reach the tools your team already uses.',
      body: [
        'Browse what is available and connect what fits how you work.',
        'For anything not listed, the API covers calls, contacts, numbers and verification &mdash; your developers can build against it directly.',
        'API keys are scoped, so a key that reads call history cannot buy a number.'
      ],
      know: ['An API key belongs on a server, never in a mobile app or a browser',
             'Keys can be revoked individually without disturbing anything else']
    }
  ]}
];
