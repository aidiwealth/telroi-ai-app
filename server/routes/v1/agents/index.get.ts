// GET /v1/agents — list the AI agents in this workspace. Scope: agents:read.
//
// This returned PBX users — the people who answer calls — through a call to the
// old provisioning client, while the documentation promised AI agents and the
// sibling /v1/agents/:id/knowledge expected one. So a developer following the
// docs got a list of staff with no usable id, and no way to reach the endpoint
// next to it. It also put SIP usernames and staff email addresses on a public
// API, which they have no business being on.
import { eq, desc } from 'drizzle-orm';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'agents:read')) throw apiError('forbidden', 'Key lacks agents:read', 403);

  const rows = await useDb().select({
    id: schema.aiAgents.id,
    name: schema.aiAgents.name,
    language: schema.aiAgents.language,
    tier: schema.aiAgents.tier,
    greeting: schema.aiAgents.greeting,
    createdAt: schema.aiAgents.createdAt
  }).from(schema.aiAgents)
    .where(eq(schema.aiAgents.tenantId, ctx.tenantId))
    .orderBy(desc(schema.aiAgents.createdAt));

  return { object: 'list', data: rows };
});
