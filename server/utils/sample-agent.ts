// server/utils/sample-agent.ts
// Every workspace gets a working AI agent from the start.
//
// A new client otherwise faces an empty AI section and has to configure three
// providers before hearing anything — which is a poor first hour, and the point
// at which people decide whether a product is worth their time. This one runs on
// our keys and our voice, so it works before they've set anything up. They still
// need a number for anyone to call it on, which is the next thing they'll want.
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export const SAMPLE_AGENT_NAME = 'Telroi Sample Agent';

const SAMPLE_GREETING =
  "Hi, thanks for calling. I'm a Telroi sample agent — I can take bookings, "
  + 'answer questions, or pass you to someone. What can I do for you?';

const SAMPLE_PROMPT =
  'You are a friendly phone receptionist demonstrating what Telroi can do. '
  + "You don't yet know this business's details, so if you're asked something "
  + 'specific, say so plainly and offer to take a message or pass the caller to '
  + 'a person. Show what you can do: take bookings, answer general questions, '
  + 'and hand over gracefully. Keep every reply to one or two short sentences '
  + 'suitable for speaking aloud. If the caller asks for a human, end your reply '
  + 'with [TRANSFER].';

/**
 * Give this workspace a sample agent if it hasn't got one. Idempotent — safe to
 * call on every load. Returns the agent, or null if it couldn't be created.
 */
export async function ensureSampleAgent(tenantId: string) {
  const db = useDb();

  const [existing] = await db.select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.tenantId, tenantId), eq(schema.aiAgents.name, SAMPLE_AGENT_NAME)))
    .limit(1);
  if (existing) return existing;

  try {
    // Managed: it runs on our providers, so a client who has configured nothing
    // still hears it work. Their own agents stay on their own keys.
    const [row] = await db.insert(schema.aiAgents).values({
      tenantId,
      name: SAMPLE_AGENT_NAME,
      greeting: SAMPLE_GREETING,
      systemPrompt: SAMPLE_PROMPT,
      tier: 'managed',
      language: 'en-NG'
    }).returning();
    return row;
  } catch {
    // A workspace that can't have a sample agent should still work.
    return null;
  }
}
