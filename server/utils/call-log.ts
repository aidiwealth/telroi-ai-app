// server/utils/call-log.ts
// Shared call-logging used by carrier webhooks + click-to-call. Upserts a call
// event keyed by (tenantId, callid) so a call's lifecycle (ringing -> answered
// -> completed/failed) updates ONE row instead of creating duplicates.
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

export interface CallEventInput {
  tenantId: string;
  callid: string;
  carrier?: string;
  direction?: 'in' | 'out' | string;
  phone?: string | null;
  user?: string | null;
  status?: string;          // ringing | answered | completed | failed | no-answer | busy | placed
  startedAt?: Date | null;
  duration?: number | null;
  recordingUrl?: string | null;
  raw?: Record<string, unknown>;
}

export async function upsertCallEvent(input: CallEventInput) {
  const db = useDb();
  try {
    const [existing] = await db.select().from(schema.callEvents)
      .where(and(eq(schema.callEvents.tenantId, input.tenantId), eq(schema.callEvents.callid, input.callid)))
      .limit(1);
    if (existing) {
      const patch: any = {};
      // Status only moves forward. Carrier events can arrive out of order (or in
      // the same second), and a stale 'ringing'/'answered' landing after the
      // hangup would leave a finished call looking live in the dashboard.
      const RANK: Record<string, number> = { ringing: 1, answered: 2, completed: 3, busy: 3, 'no-answer': 3, failed: 3, blacklisted: 3, missed: 3, ended: 3 };
      if (input.status) {
        const cur = RANK[String(existing.status || '')] ?? 0;
        const next = RANK[input.status] ?? 0;
        if (next >= cur) patch.status = input.status;
      }
      if (input.duration != null) patch.duration = input.duration;
      if (input.recordingUrl) patch.recordingUrl = input.recordingUrl;
      if (input.phone) patch.phone = input.phone;
      if (input.raw) patch.raw = { ...(existing.raw as any), ...input.raw };
      await db.update(schema.callEvents).set(patch).where(eq(schema.callEvents.id, existing.id));
      return existing.id;
    }
    const [row] = await db.insert(schema.callEvents).values({
      tenantId: input.tenantId, callid: input.callid, carrier: input.carrier || null,
      type: input.direction || 'in', direction: input.direction || 'in',
      phone: input.phone || null, user: input.user || null,
      status: input.status || 'ringing',
      startedAt: input.startedAt || new Date(),
      duration: input.duration ?? 0, wait: 0,
      recordingUrl: input.recordingUrl || null,
      raw: input.raw || {}
    }).returning({ id: schema.callEvents.id });

    // Auto-link the caller to a CRM contact (Telroi One). Inbound only, and only
    // if the tenant has CRM. Best-effort — never blocks call logging.
    if ((input.direction || 'in') === 'in' && input.phone) {
      try {
        const { hasFeature } = await import('./entitlements');
        if (await hasFeature(input.tenantId, 'crm')) {
          const { effectiveSettings } = await import('./feature-settings');
          const eff = await effectiveSettings(input.tenantId, 'crm');
          if (eff.settings.autoLinkCalls !== false) {
            const { upsertContactByPhone } = await import('./crm');
            await upsertContactByPhone(input.tenantId, input.phone, { source: 'Direct', status: (eff.settings.defaultStatus as string) || 'lead' });
          }
        }
      } catch { /* non-blocking */ }
    }
    return row?.id || null;
  } catch (e) {
    console.error('[call-log] upsert failed', e);
    return null;
  }
}

// Find which tenant owns a phone number (for inbound attribution).
export async function tenantForNumber(telnum: string): Promise<string | null> {
  if (!telnum) return null;
  const db = useDb();
  // Normalize loosely: match on suffix to tolerate +/spacing differences.
  const digits = telnum.replace(/[^\d]/g, '');
  const candidates = await db.select({ tenantId: schema.numberSubscriptions.tenantId, telnum: schema.numberSubscriptions.telnum })
    .from(schema.numberSubscriptions);
  const hit = candidates.find((c) => (c.telnum || '').replace(/[^\d]/g, '').endsWith(digits.slice(-9)));
  return hit?.tenantId || null;
}

// Map a carrier-specific status to our normalized set.
export function normalizeStatus(carrier: string, raw: string): string {
  const v = (raw || '').toLowerCase();
  if (carrier === 'twilio') {
    if (v === 'ringing' || v === 'in-progress') return v === 'ringing' ? 'ringing' : 'answered';
    if (v === 'completed') return 'completed';
    if (v === 'busy') return 'busy';
    if (v === 'no-answer') return 'no-answer';
    if (v === 'failed' || v === 'canceled') return 'failed';
  }
  if (carrier === 'telnyx') {
    if (v.includes('initiated')) return 'ringing';
    if (v.includes('answered')) return 'answered';
    if (v.includes('hangup')) return 'completed';
    // Telnyx sends plenty of non-lifecycle events (call.bridged, streaming.*,
    // speak.*, gather.*). They used to fall through and get written as the
    // status verbatim — so a bridged-then-hung-up call could end up stuck on
    // 'call.bridged', or have 'completed' clobbered by a late 'streaming.stopped'
    // arriving in the same second. Anything that isn't a lifecycle transition
    // leaves the status alone.
    return '';
  }
  return raw || 'ringing';
}
