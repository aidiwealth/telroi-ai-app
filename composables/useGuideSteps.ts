/**
 * The client's own setup, as steps.
 *
 * Deliberately not a description of the platform: each step reads what this
 * workspace has actually done and says where they stand.
 */
import { ref, computed, onMounted } from 'vue';

export interface GuideState { tone: 'ok' | 'wait' | 'todo' | 'opt'; h: string; p?: string }
export interface GuideStep {
  id: string; t: string; to: string; cta: string; done: boolean;
  state: GuideState; doThis: string[]; watch?: string; know?: string[];
  n?: number; g?: string;
}

export function useGuideSteps() {
  const ws = ref('');
  const gl = ref<any>(null);
  const wallet = ref<any>(null);
  const nums = ref<any[]>([]);
  const people = ref<any[]>([]);
  const agents = ref<any[]>([]);
  const ready = ref(false);

  onMounted(async () => {
    // Each independently: one slow call should not leave the page blank when
    // the rest of the answer is already available.
    const get = (u: string) => $fetch<any>(u).catch(() => null);
    const [me, g, w, n, p, a] = await Promise.all([
      get('/api/auth/me'), get('/api/go-live'), get('/api/wallet'),
      get('/api/voice/numbers'), get('/api/people'), get('/api/voice/agents')
    ]);
    ws.value = me?.tenant?.name || me?.workspace?.name || '';
    gl.value = g; wallet.value = w;
    nums.value = n?.numbers || n?.items || [];
    people.value = p?.people || p?.items || [];
    agents.value = a?.agents || a?.items || [];
    ready.value = true;
  });

  // Their own currency, from what the wallet already told us rather than a
  // second guess about which one they are in.
  const money = (minor: number) => {
    const sym = (wallet.value?.currency || 'NGN') === 'NGN' ? '\u20A6' : '$';
    return sym + ((minor || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const bal = computed(() => wallet.value?.balanceMinor ?? null);
  const funded = computed(() => (bal.value ?? 0) > 0);
  const approved = computed(() => !!gl.value?.approved);
  const isLive = computed(() => !!gl.value?.live);
  const inReview = computed(() => ['pending', 'review', 'submitted']
    .includes(String(gl.value?.complianceStatus || '')));
  const hasNum = computed(() => nums.value.length > 0);
  const routed = computed(() => nums.value.some((x: any) => x.routeType && x.routeType !== 'none'));
  const hasTeam = computed(() => people.value.length > 1);
  const hasAgent = computed(() => agents.value.length > 0);

  const RAW = computed(() => [
    { g: 'Before you can go live', items: [
      {
        id: 'wallet', t: 'Put money in your wallet', to: '/wallet', cta: 'Open Wallet',
        done: funded.value,
        state: funded.value
          ? { tone: 'ok', h: `Your balance is ${money(bal.value || 0)}`,
              p: 'Calls, numbers and AI all draw from here.' }
          : { tone: 'todo', h: 'Your wallet is empty',
              p: 'Nothing can be bought or answered until there is money in it.' },
        doThis: [
          'Transfer to your own dedicated account number &mdash; it is permanent, so save it as a beneficiary. The balance moves on its own once your bank confirms.',
          'Or pay by card if you need the balance this minute.'
        ],
        watch: 'Your bank tells us the money arrived, not the payment page, so the balance can lag a few seconds behind. Refresh before assuming it failed.',
        know: ['Keep roughly a week of usage as a buffer',
               'Every charge on your statement says what it was for']
      },
      {
        id: 'compliance', t: 'Verify your business', to: '/settings', cta: 'Open Settings',
        done: approved.value,
        state: approved.value
          ? { tone: 'ok', h: 'Verified', p: 'You can buy numbers and go live.' }
          : inReview.value
            ? { tone: 'wait', h: 'In review',
                p: 'Usually a working day or two. You can build everything meanwhile.' }
            : { tone: 'todo', h: 'Not started',
                p: gl.value?.blockedReason
                   || 'Regulators require every business number to trace to an identified business.' },
        doThis: [
          '<b>In Nigeria:</b> your NIN, or your CAC registration if registering as a company, plus proof of address.',
          'Upload the signed <b>NCC undertaking</b>.',
          '<b>Elsewhere:</b> usually a business registration and proof of address.'
        ],
        know: ['Start this first &mdash; it runs while you build everything else',
               'Your demo number works throughout']
      }
    ]},

    { g: 'Answering calls', items: [
      {
        id: 'number', t: 'Get a number', to: '/numbers', cta: 'Open Numbers',
        done: hasNum.value,
        state: hasNum.value
          ? { tone: 'ok', h: nums.value.length === 1 ? 'One number' : `${nums.value.length} numbers`,
              p: nums.value.map((x: any) => x.telnum).slice(0, 3).join('   \u00B7   ') }
          : approved.value
            ? { tone: 'todo', h: 'No numbers yet', p: 'You are verified, so you can buy one now.' }
            : { tone: 'wait', h: 'Waiting on verification',
                p: gl.value?.demoNumber
                   ? `Test on ${gl.value.demoNumber} meanwhile.`
                   : 'Your demo number works meanwhile.' },
        doThis: [
          'Search by country and area, and pick a number.',
          'Say what it will be used for &mdash; this decides whether an agreement is needed.',
          'Confirm. The monthly fee comes from your wallet and it is live within a minute or two.'
        ],
        watch: 'Six uses carry regulatory weight &mdash; <b>authentication, financial, health, emergency, government and outbound</b>. Choosing one shows a short agreement before purchase, and we record which version you accepted.',
        know: ['A number bills monthly from your wallet',
               'Recording is per number and off unless you turn it on']
      },
      {
        id: 'routing', t: 'Decide who answers', to: '/numbers', cta: 'Open Numbers',
        done: routed.value,
        state: routed.value
          ? { tone: 'ok', h: 'Your calls have somewhere to go' }
          : { tone: 'todo', h: 'Nothing is answering yet',
              p: 'A number with no route rings out. Point it at a person, a team or an agent.' },
        doThis: [
          '<b>One person</b> &mdash; a direct line, ringing wherever they are signed in.',
          '<b>A team</b> &mdash; everyone rings at once and the first to answer takes it.',
          '<b>An AI agent</b> &mdash; it answers, handles what it can, and fetches a person when it should.',
          'Then set the <b>escalation</b>: where the call goes if nobody picks up.'
        ],
        watch: 'If your team answers in the browser, <b>the Telroi tab must be open</b>. A closed tab is an unplugged phone &mdash; the call rings, nobody answers, and the caller hears your unavailable message. Signing in on the mobile app removes that dependency.',
        know: ['Changes take effect on the next call',
               'A number with no escalation rings out to voicemail']
      },
      {
        id: 'team', t: 'Invite your team', to: '/people', cta: 'Open People',
        done: hasTeam.value,
        state: hasTeam.value
          ? { tone: 'ok', h: `${people.value.length} people` }
          : { tone: 'todo', h: 'It is just you',
              p: 'Fine for now. Invite colleagues when you want calls to ring more than one place.' },
        doThis: [
          'Invite by email. They sign in with a code, the same way you did.',
          'Give them a role: <b>owner</b> for everything, <b>admin</b> for numbers and routing, <b>member</b> for making and taking calls.',
          'Put people into <b>Teams</b> so a number can ring a department at once.'
        ],
        know: ['Most people should be members',
               'Removing somebody ends their access immediately']
      }
    ]},

    { g: 'When you are ready', items: [
      {
        id: 'ai', t: 'Add an AI agent', to: '/vans', cta: 'Open AI Numbers',
        done: hasAgent.value,
        state: hasAgent.value
          ? { tone: 'ok', h: agents.value.length === 1 ? 'One agent' : `${agents.value.length} agents`,
              p: agents.value.map((a: any) => a.name).filter(Boolean).slice(0, 3).join('   \u00B7   ') }
          : { tone: 'opt', h: 'Optional',
              p: 'An agent answers when nobody is free, and handles the routine calls entirely.' },
        doThis: [
          'Give it a name and a voice.',
          'Write its instructions: what you sell, how you answer common questions, what it must never promise.',
          'Set when it hands over &mdash; usually when asked, or after a couple of unhelpful exchanges.',
          'Call your demo number and say the awkward things a customer would.'
        ],
        watch: 'AI is charged by how much it hears and says, so <b>vague instructions are both worse and more expensive</b>. Be specific, ask for short answers, and say plainly what it must never claim.',
        know: ['A daily limit stops the AI once reached &mdash; calls go to your team instead',
               'A draft agent costs nothing until it answers a call']
      },
      {
        id: 'golive', t: 'Go live', to: '/settings', cta: 'Open Settings',
        done: isLive.value,
        state: isLive.value
          ? { tone: 'ok', h: 'You are live', p: 'Real calls, real charges.' }
          : approved.value
            ? { tone: 'todo', h: 'Ready when you are',
                p: 'Verification has cleared. Going live switches on real calls and real charges.' }
            : { tone: 'wait', h: 'Not yet',
                p: 'Verification has to clear first. Everything you build now carries over.' },
        doThis: [
          'Check your routing is pointing where you want it.',
          'Make sure there is enough in your wallet for the first week.',
          'Switch on. Nothing you have built changes &mdash; calls simply reach the real network.'
        ],
        know: ['Sandbox charges were recorded, not taken',
               'You can see what your first month will cost before committing']
      }
    ]}
  ]);

  // Numbered once, so the rail, the progress and the next button all agree
  // without three places to keep in step.
  const steps = computed<GuideStep[]>(() => {
    let n = 0;
    return RAW.value.flatMap(g => g.items.map(it => ({ ...it, n: ++n, g: g.g }) as GuideStep));
  });
  const groups = computed(() => RAW.value.map(g => ({
    label: g.g, steps: steps.value.filter(s => s.g === g.g)
  })));
  const doneCount = computed(() => steps.value.filter(s => s.done).length);
  const pct = computed(() => Math.round((doneCount.value / steps.value.length) * 100));

  return { ws, ready, steps, groups, doneCount, pct };
}
