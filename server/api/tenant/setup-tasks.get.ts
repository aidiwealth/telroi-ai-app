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

  // ── Client-actionable ──
  if (!card) tasks.push({
    id: 'add-card', owner: 'client', priority: 1,
    title: 'Add a payment method',
    desc: 'Save a card so your wallet can auto-top-up and your service never pauses.',
    action: { label: 'Add card', to: '/wallet' }
  });

  if (wallet && wallet.balanceMinor <= 0) tasks.push({
    id: 'fund-wallet', owner: 'client', priority: 2,
    title: 'Add funds to your wallet',
    desc: 'Your balance is empty. Top up to start making and receiving calls.',
    action: { label: 'Top up', to: '/wallet' }
  });

  if (!numbers.length) tasks.push({
    id: 'get-number', owner: 'client', priority: 3,
    title: 'Get a phone number',
    desc: 'Add a business number so customers can reach you.',
    action: { label: 'Browse numbers', to: '/numbers' }
  });

  if (!agents.length) tasks.push({
    id: 'connect-ai', owner: 'client', priority: 4,
    title: 'Connect an AI provider',
    desc: 'Link an AI key to power your Virtual AI Numbers and agents.',
    action: { label: 'Connect AI', to: '/ai' }
  });

  if (agents.length && !vans.length) tasks.push({
    id: 'create-van', owner: 'client', priority: 5,
    title: 'Create your first AI Number',
    desc: 'Bind a number to an AI agent so calls are handled automatically.',
    action: { label: 'Create AI Number', to: '/vans' }
  });

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
  return { tasks, supportEmail: 'support@telroi.ai' };
});
