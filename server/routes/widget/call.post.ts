// POST /widget/call { key, sessionId } -> initiate the call leg. CORS-open.
// Routes to agent or AI per config. The actual media bridge (WebRTC<->carrier)
// runs on live infra; here we mark the session calling + return routing info.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { tenantByWidgetKey, widgetConfig } from '~/server/utils/live-call';
import { useDb, schema } from '~/server/db';
const Body = z.object({ key: z.string(), sessionId: z.string().uuid() });
export default defineEventHandler(async (event) => {
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  const p = Body.safeParse(await readBody(event));
  if (!p.success) { setResponseStatus(event, 400); return { error: 'invalid' }; }
  const t = await tenantByWidgetKey(p.data.key);
  if (!t) { setResponseStatus(event, 404); return { error: 'invalid_key' }; }
  const db = useDb();
  const { effectiveSettings } = await import('~/server/utils/feature-settings');
  const eff = await effectiveSettings(t.id, 'live_call');
  const cfg = eff.settings as any;

  // The visitor's session carries their detected country — used to route by
  // location (Nigerian callers -> NG carrier/VAN; others -> international).
  const [visitorSession] = await db.select().from(schema.liveCallSessions)
    .where(and(eq(schema.liveCallSessions.id, p.data.sessionId), eq(schema.liveCallSessions.tenantId, t.id))).limit(1);
  const visitorCountry = visitorSession?.country || null;
  const { isNigeria } = await import('~/server/utils/countries');
  const callerIsNG = isNigeria(visitorCountry);
  // NG carriers vs international carriers, for matching a VAN to the caller's region.
  const NG_PROVIDERS = ['telroi'];

  // Resolve the concrete routing target so the call can actually be handled.
  let routeTarget: any = { mode: cfg.routeTo };
  if (cfg.routeTo === 'ai') {
    // Link to a specific AI agent (or the tenant's first agent as default).
    let agentId = cfg.aiAgentId;
    if (!agentId) {
      const [a] = await db.select({ id: schema.aiAgents.id }).from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, t.id)).limit(1);
      agentId = a?.id || null;
    }
    routeTarget.aiAgentId = agentId || null;
    // Bind into the Virtual AI Number (VAN) infrastructure, choosing a VAN that
    // matches the CALLER'S REGION so one widget serves everyone: a Nigerian
    // caller gets a VAN on an NG carrier (Digidite/Sotel); an international
    // caller gets a VAN on Telnyx/Twilio. This is what lets the single support
    // (or client) Live Call line answer both NG and non-NG callers correctly.
    const activeVans = await db.select().from(schema.vans)
      .where(and(eq(schema.vans.tenantId, t.id), eq(schema.vans.status, 'live')));
    const regionMatch = (v: any) => callerIsNG ? NG_PROVIDERS.includes(v.provider) : !NG_PROVIDERS.includes(v.provider);
    let van =
      // 1. A VAN for the chosen agent that also matches the caller's region.
      (agentId && activeVans.find((v) => v.agentId === agentId && regionMatch(v))) ||
      // 2. Any active VAN matching the caller's region.
      activeVans.find(regionMatch) ||
      // 3. A VAN for the chosen agent (region not available).
      (agentId && activeVans.find((v) => v.agentId === agentId)) ||
      // 4. Any active VAN at all.
      activeVans[0] || null;
    if (van) {
      routeTarget.vanId = van.id;
      routeTarget.vanTelnum = van.telnum;
      routeTarget.vanProvider = van.provider;
      routeTarget.vanRegionMatched = regionMatch(van);
      routeTarget.aiAgentId = van.agentId || agentId || null;
      routeTarget.escalateTo = van.escalateTo || null;
      routeTarget.escalateAfter = van.escalateAfter || 0;
    }
  } else {
    // Route to a team (department); collect members who can take calls.
    let teamId = cfg.routeTeamId || null;
    if (!teamId) {
      const [d] = await db.select({ id: schema.departments.id }).from(schema.departments).where(eq(schema.departments.tenantId, t.id)).limit(1);
      teamId = d?.id || null;
    }
    routeTarget.teamId = teamId;
    if (teamId) {
      const members = await db.select({ userId: schema.departmentMembers.userId })
        .from(schema.departmentMembers).where(eq(schema.departmentMembers.departmentId, teamId));
      routeTarget.memberUserIds = members.map((m) => m.userId);
    }
  }

  // Resolve a display label for "who handled it" (CSAT by agent).
  let handledByLabel = cfg.routeTo === 'ai' ? 'AI agent' : 'Support team';
  if (cfg.routeTo === 'ai' && routeTarget.aiAgentId) {
    const [a] = await db.select({ name: schema.aiAgents.name }).from(schema.aiAgents).where(eq(schema.aiAgents.id, routeTarget.aiAgentId)).limit(1);
    if (a?.name) handledByLabel = a.name;
  } else if (cfg.routeTo === 'agent' && routeTarget.teamId) {
    const [d] = await db.select({ name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.id, routeTarget.teamId)).limit(1);
    if (d?.name) handledByLabel = d.name;
  }

  // Resolve which voice provider powers this call + the dial intent.
  const { resolveLiveCallProvider } = await import('~/server/utils/live-call-provider');
  const sessForGeo = visitorSession; // already fetched at the top
  // If this is Telroi's own support workspace, dial from the admin-configured
  // per-region support number (NG vs international) instead of an arbitrary
  // subscription — so the number admin picked in Settings powers the call.
  let preferredFromNumber: string | null = null;
  try {
    const { ensureSupportWorkspace } = await import('~/server/utils/support');
    const support = await ensureSupportWorkspace();
    if (support.tenantId === t.id) {
      const { supportNumberForCountry } = await import('~/server/utils/support-numbers');
      preferredFromNumber = await supportNumberForCountry(visitorCountry);
    }
  } catch { /* not the support workspace, or not configured */ }
  const dial = await resolveLiveCallProvider({
    tenantId: t.id,
    configuredProvider: (cfg.callProvider as string) || 'auto',
    visitorCountry: visitorCountry,
    teamId: routeTarget.teamId || null,
    toRoute: routeTarget,
    preferredFromNumber
  });

  // Enforce the tenant's paid channel capacity before connecting. Internal
  // (support) workspaces are exempt; sandbox is exempt. When all lines are busy
  // we mark the session missed and return a clear "busy" signal to the widget.
  try {
    const { isSandbox } = await import('~/server/utils/sandbox');
    if (!t.isInternal && !(await isSandbox(t.id))) {
      const { assertChannelAvailable } = await import('~/server/utils/channel-limits');
      await assertChannelAvailable(t.id);
    }
  } catch (ce: any) {
    await db.update(schema.liveCallSessions)
      .set({ status: 'missed', outcome: 'channels_busy' })
      .where(and(eq(schema.liveCallSessions.id, p.data.sessionId), eq(schema.liveCallSessions.tenantId, t.id)));
    setResponseStatus(event, ce?.statusCode || 429);
    return { error: ce?.data?.error?.code || 'channels_busy', message: ce?.data?.error?.message || 'All lines are busy. Please try again shortly.' };
  }

  await db.update(schema.liveCallSessions)
    .set({ status: 'calling', routedTo: cfg.routeTo as string, handledByLabel })
    .where(and(eq(schema.liveCallSessions.id, p.data.sessionId), eq(schema.liveCallSessions.tenantId, t.id)));
  // Log a call event so it appears in the client's call logs too, with the
  // resolved provider + from-number recorded.
  try {
    const { upsertCallEvent } = await import('~/server/utils/call-log');
    if (sessForGeo) await upsertCallEvent({ tenantId: t.id, callid: `lc_${sessForGeo.id}`, direction: 'in', phone: sessForGeo.visitorPhone || '', carrier: dial.provider, status: 'ringing', raw: { source: 'live_call', route: routeTarget, provider: dial.provider, fromNumber: dial.fromNumber, providerReason: dial.reason, providerReady: dial.ready } });
  } catch { /* */ }
  // Mint a browser-voice token for the resolved provider so the widget can open
  // a real WebRTC leg (mic + audio). If the provider isn't configured, the
  // widget shows a graceful message instead of a fake "connecting".
  let voiceToken: any = null;
  try {
    const { voiceTokenFor } = await import('~/server/utils/voice-token');
    voiceToken = await voiceTokenFor(dial.provider, `widget_${t.id}_${p.data.sessionId}`);
  } catch { voiceToken = null; }

  // The dial intent tells the live media layer exactly how to bridge:
  //   provider (digidite|telnyx|twilio), fromNumber, and who to connect to.
  return {
    ok: true,
    routedTo: cfg.routeTo,
    route: routeTarget,
    mode: 'webrtc',
    dial: { provider: dial.provider, ready: dial.ready, fromNumber: dial.fromNumber, reason: dial.reason },
    voice: voiceToken      // null when provider not configured
  };
});
