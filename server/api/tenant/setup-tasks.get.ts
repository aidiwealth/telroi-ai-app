// GET /api/tenant/setup-tasks -> the client's post-onboarding to-do list,
// computed from REAL account state so items vanish automatically once resolved.
// Each task is tagged by owner: 'client' (they can act, with a route), 'admin'
// (pending on our team), or 'support' (contact support@telroi.ai).
import { eq, and } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const tid = s.tenantId;

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tid)).limit(1);
  if (!tenant) return { tasks: [] };

  // Gather signals in parallel (counts only — cheap).
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tid)).limit(1);
  const [card] = await db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.tenantId, tid)).limit(1);
  const numbers = await db.select().from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, tid));
  const agents = await db.select().from(schema.aiConnections).where(eq(schema.aiConnections.tenantId, tid));
  const vans = await db.select().from(schema.vans).where(eq(schema.vans.tenantId, tid));

  const tasks: any[] = [];

  // ── The setup path ──
  // Every step, done or not, so the client can see how far along they are rather
  // than only what's still missing. A list that shrinks tells you nothing about
  // whether you're nearly there.
  const steps = [
    {
      id: 'add-card', owner: 'client', priority: 1, icon: 'credit-card',
      done: !!card,
      title: 'Add a payment method',
      desc: 'Save a card so your wallet can top itself up and your service never pauses.',
      action: { label: 'Add card', to: '/wallet' }
    },
    {
      id: 'fund-wallet', owner: 'client', priority: 2, icon: 'wallet',
      done: !!(wallet && wallet.balanceMinor > 0),
      title: 'Add funds to your wallet',
      desc: 'Calls and numbers are charged from here. Top up to start.',
      action: { label: 'Top up', to: '/wallet' }
    },
    {
      id: 'get-number', owner: 'client', priority: 3, icon: 'phone-plus',
      done: numbers.length > 0,
      title: 'Get a phone number',
      desc: 'A business number so customers have somewhere to reach you.',
      action: { label: 'Browse numbers', to: '/numbers' }
    },
    {
      id: 'connect-ai', owner: 'client', priority: 4, icon: 'plug-connected',
      done: agents.length > 0,
      title: 'Connect an AI provider',
      desc: 'Link a key so your AI numbers can listen, think and speak.',
      action: { label: 'Connect AI', to: '/ai' }
    },
    {
      id: 'create-van', owner: 'client', priority: 5, icon: 'robot',
      done: vans.length > 0,
      title: 'Create your first AI number',
      desc: 'Bind a number to an agent so calls are answered automatically.',
      action: { label: 'Create AI number', to: '/vans' }
    }
  ];
  for (const st of steps) if (!st.done) tasks.push(st);

  // ── Admin-pending (we owe the client an activation) ──
  if (!tenant.telroiDomain) tasks.push({
    id: 'await-provision', owner: 'admin', priority: 6,
    title: 'Voice service is being activated',
    desc: 'Our team is provisioning your voice workspace. This usually completes shortly after signup — no action needed from you.'
  });

  // A VAN that the client set up but is still pending activation on our side.
  const pendingVan = vans.find((v) => v.status === 'draft');
  if (pendingVan) tasks.push({
    id: 'van-activating', owner: 'admin', priority: 7,
    title: 'Your AI Number is activating',
    desc: `"${pendingVan.name}" is being switched on by our team. You'll be able to take live calls once it's active.`
  });

  // ── Support ──
  // Offer a support nudge if voice failed to provision (stuck state).
  if (tenant.telroiDomain && numbers.some((n) => (n as any).provisionStatus === 'failed')) tasks.push({
    id: 'number-failed', owner: 'support', priority: 8,
    title: 'A number needs attention',
    desc: 'One of your numbers failed to activate. Our support team can resolve this quickly.'
  });

  tasks.sort((a, b) => a.priority - b.priority);

  // Progress counts the setup path only. What our team is activating, and
  // anything that has gone wrong, are states rather than steps — putting them in
  // the count would make the finish line move for reasons the client can't act on.
  const completed = steps.filter((st) => st.done).length;
  return {
    tasks,
    steps,
    progress: { completed, total: steps.length },
    supportEmail: 'support@telroi.ai'
  };
});
