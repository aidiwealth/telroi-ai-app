// POST /api/copilot/execute — runs a copilot Tier-2 action AFTER the user confirms it
// in the UI. The LLM only ever *proposes* actions (in /chat); nothing here runs without
// an explicit confirm click. Each action re-validates and reuses existing tenant-scoped
// logic. Tier 2 = reversible, no-spend actions only.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const AGENT_LANGS = ['en-NG','yo-NG','ig-NG','ha-NG','sw-KE','am-ET','zu-ZA','af-ZA','en-US','en-GB','fr-FR','ar-XA','pt-PT','es-ES','de-DE','hi-IN','zh'];

// Allow-list of Tier-2 actions with their arg schemas. Anything not here is rejected.
const ACTIONS: Record<string, z.ZodTypeAny> = {
  create_van: z.object({ name: z.string().min(1), telnum: z.string().min(3), agentId: z.string().uuid().optional() }),
  add_blacklist: z.object({ telnum: z.string().min(3), comment: z.string().optional() }),
  create_department: z.object({ name: z.string().min(1).max(80), description: z.string().max(300).optional() }),
  set_agent_language: z.object({ agentId: z.string().uuid(), language: z.enum(AGENT_LANGS as [string, ...string[]]) }),
  knowledge_url: z.object({ agentId: z.string().uuid(), url: z.string().min(4) }),
  knowledge_drive: z.object({ agentId: z.string().uuid(), url: z.string().min(4) }),
  toggle_feature: z.object({ feature: z.string().min(1), enabled: z.boolean() }),
  buy_number: z.object({ inventoryId: z.string().uuid(), channels: z.number().int().min(1).max(50).optional() })
};

async function assertAgent(db: any, tenantId: string, agentId: string) {
  const [a] = await db.select({ id: schema.aiAgents.id }).from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, tenantId))).limit(1);
  if (!a) throw apiError('not_found', 'agent not found', 404);
}

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const body = await readBody(event);
  const action = (body?.action || '').toString();
  const schemaFor = ACTIONS[action];
  if (!schemaFor) throw apiError('invalid', 'Unknown or unsupported action', 400);
  const p = schemaFor.safeParse(body?.args || {});
  if (!p.success) throw apiError('invalid', 'Invalid action arguments: ' + (p.error.issues?.[0]?.message || ''), 400);
  const args: any = p.data;
  const db = useDb();

  switch (action) {
    case 'create_van': {
      if (args.agentId) await assertAgent(db, s.tenantId, args.agentId);
      // Mirror /api/vans: resolve provider kind from the number's subscription.
      const [sub] = await db.select().from(schema.numberSubscriptions)
        .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId), eq(schema.numberSubscriptions.telnum, args.telnum))).limit(1);
      if (!sub) throw apiError('invalid', 'That number is not on your account. Buy or add it first.', 400);
      const providerKind = (sub.provider === 'twilio' || sub.provider === 'telnyx') ? sub.provider : 'telroi';
      const [row] = await db.insert(schema.vans).values({ tenantId: s.tenantId, name: args.name, telnum: args.telnum, agentId: args.agentId || null, provider: providerKind }).returning();
      return { ok: true, message: `Created Virtual AI Number "${args.name}" on ${args.telnum}.`, result: { id: row.id } };
    }
    case 'add_blacklist': {
      await db.insert(schema.blacklist).values({ tenantId: s.tenantId, telnum: args.telnum, comment: args.comment || null }).onConflictDoNothing();
      return { ok: true, message: `Blocked ${args.telnum}.` };
    }
    case 'create_department': {
      const [row] = await db.insert(schema.departments).values({ tenantId: s.tenantId, name: args.name, description: args.description || null }).returning();
      return { ok: true, message: `Created department "${args.name}".`, result: { id: row.id } };
    }
    case 'set_agent_language': {
      await assertAgent(db, s.tenantId, args.agentId);
      await db.update(schema.aiAgents).set({ language: args.language, updatedAt: new Date() }).where(eq(schema.aiAgents.id, args.agentId));
      return { ok: true, message: `Set the agent's language to ${args.language}.` };
    }
    case 'knowledge_url':
    case 'knowledge_drive': {
      await assertAgent(db, s.tenantId, args.agentId);
      // Reuse the real import endpoints via internal fetch (they handle extraction).
      const path = action === 'knowledge_url' ? 'import-url' : 'import-drive';
      const r = await $fetch(`/api/agents/${args.agentId}/knowledge/${path}`, {
        method: 'POST', body: { url: args.url }, headers: { cookie: getHeader(event, 'cookie') || '' }
      }).catch((e: any) => { throw apiError('invalid', e?.data?.message || 'Import failed', 400); });
      return { ok: true, message: 'Added to the knowledge base.', result: r };
    }
    case 'toggle_feature': {
      const r = await $fetch(`/api/feature-settings/${encodeURIComponent(args.feature)}`, {
        method: 'PUT', body: { enabled: args.enabled }, headers: { cookie: getHeader(event, 'cookie') || '' }
      }).catch((e: any) => { throw apiError('invalid', e?.data?.message || 'Could not update feature', 400); });
      return { ok: true, message: `${args.enabled ? 'Enabled' : 'Disabled'} ${args.feature}.`, result: r };
    }
    case 'buy_number': {
      // Reuse the real purchase endpoint (inventory lock + wallet debit + provisioning).
      // Dashboard path: debit the wallet directly; if funds are short it errors clearly.
      const r = await $fetch('/api/numbers/purchase', {
        method: 'POST', body: { inventoryId: args.inventoryId, channels: args.channels || 1 },
        headers: { cookie: getHeader(event, 'cookie') || '' }
      }).catch((e: any) => { throw apiError('invalid', e?.data?.message || 'Could not buy that number. Check your wallet balance.', 400); });
      return { ok: true, message: 'Number purchased and added to your account.', result: r };
    }
  }
  throw apiError('invalid', 'Unhandled action', 400);
});
