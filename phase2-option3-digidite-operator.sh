#!/usr/bin/env bash
# ============================================================================
# Phase 2 / Option 3: Remove the external Digidite OPERATOR (domain creation,
# sessions, employee mgmt, telnum allocation). The per-tenant TelroiClient
# STAYS (it's the voice control plane → replaced incrementally by ARI in Part B).
#
# Run from repo root on `refactor-asterisk-backbone`, AFTER Phase 1 is committed.
# After running: `npx nuxi build` → confirm GREEN → commit.
# ============================================================================
set -e
cd "$(git rev-parse --show-toplevel)"
echo "Branch: $(git branch --show-current)"

# --- 1. Delete obsolete Digidite-UI session endpoints -----------------------
rm -f "server/api/admin/clients/[domain]/session.get.ts"
rm -f "server/api/voice/my-session.get.ts"
echo "✓ deleted session.get.ts + my-session.get.ts"

# --- 2. clients/index.post.ts: createDomain → local provision flip ----------
python3 - << 'PY'
p='server/api/admin/clients/index.post.ts'; s=open(p).read()
old="""  let provisioned = false;
  let provisionError: string | null = null;
  if (p.data.provisionNow) {
    try {
      const { OperatorClient, resolveDomainDefaults } = await import('~/server/utils/telroi/operator');
      const op = await OperatorClient.fromPlatform();
      const defaults = await resolveDomainDefaults(op, settings);
      try {
        await op.createDomain(fullDomain, {
          name: fullDomain, accessURL: `https://${fullDomain}`,
          client: p.data.client, language: p.data.language,
          accountsLimit: p.data.accountsLimit, maxLines: p.data.maxLines, billingType: 'demo',
          ...defaults
        });
      } catch (e: any) {
        const msg = e?.data?.error?.message || e?.message || '';
        const exists = e?.statusCode === 409 || /exist/i.test(typeof msg === 'string' ? msg : JSON.stringify(msg));
        if (!exists) throw e;
      }
      await db.update(schema.tenants)
        .set({ telroiApiKeyEnc: settings?.operatorApiKeyEnc ?? null, provisionState: 'provisioned', wentLiveAt: new Date() })
        .where(eq(schema.tenants.id, tenant.id));
      provisioned = true;
    } catch (e: any) {
      const m = e?.data?.error?.message || e?.message || String(e);
      provisionError = typeof m === 'string' ? m : JSON.stringify(m);
      console.error('[admin create] eager provisioning failed (client still created locally)', e);
    }
  }"""
new="""  let provisioned = false;
  let provisionError: string | null = null;
  if (p.data.provisionNow) {
    // Mark the workspace live. Voice provisioning on our own Asterisk PBX happens
    // separately (SIP endpoints are provisioned per-device via the provisioning
    // agent), so client creation no longer calls an external operator.
    try {
      await db.update(schema.tenants)
        .set({ provisionState: 'provisioned', wentLiveAt: new Date() })
        .where(eq(schema.tenants.id, tenant.id));
      provisioned = true;
    } catch (e: any) {
      const m = e?.message || String(e);
      provisionError = typeof m === 'string' ? m : JSON.stringify(m);
      console.error('[admin create] marking provisioned failed (client still created locally)', e);
    }
  }"""
assert old in s, "clients/index.post.ts block not found (already applied?)"
open(p,'w').write(s.replace(old,new)); print("✓ clients/index.post.ts")
PY

# --- 3. provisioning.ts: rewrite to local-only ------------------------------
python3 - << 'PY'
p='server/utils/provisioning.ts'; s=open(p).read()
import re
s=s.replace("""import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { encrypt } from './crypto';
import { OperatorClient, resolveDomainDefaults } from './telroi/operator';
import { platformSettings } from './platform';
import { logEvent } from './logs';""",
"""import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { logEvent } from './logs';""")
new_fn='''export async function provisionTenant(tenantId: string): Promise<ProvisionResult> {
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!t) return { ok: false, reason: 'tenant_not_found' };
  if (t.provisionState === 'provisioned') return { ok: true, domain: t.slug };
  try {
    await db.update(schema.tenants)
      .set({ provisionState: 'provisioned', wentLiveAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    await logEvent({ tenantId, kind: 'system', action: 'provision.success', summary: `Workspace ${t.slug} marked live` });
    return { ok: true, domain: t.slug };
  } catch (e: any) {
    const msg = e?.message || 'unknown error';
    await logEvent({ tenantId, kind: 'system', action: 'provision.failed', level: 'error', summary: msg });
    return { ok: false, reason: msg };
  }
}'''
s=re.sub(r"export async function provisionTenant\(tenantId: string\): Promise<ProvisionResult> \{.*?\n\}\n", new_fn+"\n", s, flags=re.S)
open(p,'w').write(s); print("✓ provisioning.ts")
PY

# --- 4. attach-number.post.ts: drop operator block --------------------------
python3 - << 'PY'
p='server/api/voice/sip/endpoints/[id]/attach-number.post.ts'; s=open(p).read()
s=s.replace("import { masterCarrierCreds, platformSettings } from '~/server/utils/platform';","import { masterCarrierCreds } from '~/server/utils/platform';")
s=s.replace("import { OperatorClient } from '~/server/utils/telroi/operator';\n","")
old="""    const settings = await platformSettings().catch(() => null);
    const platformDomain = (settings as any)?.operatorDomain || (creds as any)?.telroiPbx?.domain;
    if (!platformDomain) throw apiError('not_configured', 'Platform voice domain is not configured.', 503);
    try {
      const op = await OperatorClient.fromPlatform();
      await op.allocateTelnum(p.data.telnum).catch(() => {});
      await op.assignTelnumToDomain(platformDomain, p.data.telnum);
      await op.enableDomainTelnum(platformDomain, p.data.telnum).catch(() => {});
    } catch (e: any) {
      throw apiError('operator_failed', e?.data?.error?.message || e?.message || 'Could not assign the number on the voice platform.', 502);
    }
    await db.update(schema.numberSubscriptions)
      .set({ provider: 'telroi' })
      .where(and(eq(schema.numberSubscriptions.telnum, p.data.telnum), eq(schema.numberSubscriptions.tenantId, s.tenantId)));
    await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.attach_number', summary: `Routed ${p.data.telnum} to voice platform for SIP delivery` });
    return { ok: true, provider: 'telroi', telnum: p.data.telnum };"""
new="""    // Non-tnt_ telroi endpoints are legacy; all current endpoints are Asterisk-backed
    // (tnt_) and handled above. Fall back to a local route update pointing the number
    // at this endpoint, so routing stays consistent on our own PBX.
    const upd = await db.update(schema.numberSubscriptions)
      .set({ provider: 'telroi', routeType: 'person', routeTarget: ep.id })
      .where(and(eq(schema.numberSubscriptions.telnum, p.data.telnum), eq(schema.numberSubscriptions.tenantId, s.tenantId)))
      .returning();
    if (!upd.length) throw apiError('not_found', 'That number is not on your account, or is not active.', 404);
    await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.attach_number', summary: `Routed ${p.data.telnum} to SIP device` });
    return { ok: true, provider: 'telroi', telnum: p.data.telnum };"""
assert old in s, "attach-number block not found"
open(p,'w').write(s.replace(old,new)); print("✓ attach-number.post.ts")
PY

# --- 5. clients/index.get.ts: listDomains → local provisionState ------------
python3 - << 'PY'
p='server/api/admin/clients/index.get.ts'; s=open(p).read()
s=s.replace("import { OperatorClient } from '~/server/utils/telroi/operator';\n","")
s=s.replace("""  let provisioned = new Set<string>();
  try {
    const op = await OperatorClient.fromPlatform();
    provisioned = new Set(await op.listDomains());
  } catch { /* operator unreachable — DB list still complete */ }

""","")
s=s.replace("      domain: t.telroiDomain || `${t.slug}.telroi.ai`,","      domain: `${t.slug}.telroi.ai`,")
s=s.replace("      provisioned: t.telroiDomain ? provisioned.has(t.telroiDomain) : false,","      provisioned: t.provisionState === 'provisioned',")
open(p,'w').write(s); print("✓ clients/index.get.ts")
PY

# --- 6. clients/[domain].get.ts: source employees/voice from local DB -------
python3 - << 'PY'
p='server/api/admin/clients/[domain].get.ts'; s=open(p).read()
s=s.replace("import { OperatorClient } from '~/server/utils/telroi/operator';\n","")
s=s.replace("""  // Live Digitide data if this tenant is provisioned and operator is reachable.
  let info: any = null, employees: any[] = [];
  if (tenant.telroiDomain) {
    try {
      const op = await OperatorClient.fromPlatform();
      [info, employees] = await Promise.all([
        op.getDomain(tenant.telroiDomain).catch(() => null),
        op.listEmployees(tenant.telroiDomain).catch(() => [])
      ]);
    } catch { /* operator unreachable */ }
  }""",
"""  // Employees come from our own membership records (the source of truth).
  let info: any = null;
  let employees: any[] = [];
  try {
    const mems = await db.select().from(schema.memberships).where(eq(schema.memberships.tenantId, tenant.id));
    employees = mems.map((m: any) => ({ login: m.pbxLogin || m.userId, email: undefined, role: m.role }));
  } catch { /* best-effort */ }""")
s=s.replace("""  let voice: any = { available: false, recentCount: 0, recent: [] as any[] };
  if (tenant.telroiDomain && tenant.telroiApiKeyEnc) {
    try {
      const tc = TelroiClient.forTenant(tenant);
      const calls = await tc.historyJson({ period: 'week', limit: 5, processMissed: true });
      const list = Array.isArray(calls) ? calls : ((calls as any)?.items || []);
      voice = {
        available: true,
        recentCount: list.length,
        recent: list.slice(0, 5).map((c: any) => ({
          from: c.caller || c.from || c.src || '—',
          to: c.callee || c.to || c.dst || '—',
          when: c.start || c.time || c.date || null,
          status: c.status || c.disposition || '—'
        }))
      };
    } catch { /* voice not reachable — leave unavailable */ }
  }""",
"""  // Voice activity is sourced from our own call-events table (merged below).
  let voice: any = { available: false, recentCount: 0, recent: [] as any[] };""")
s=s.replace("domain: tenant.telroiDomain || `${tenant.slug}.telroi.ai`, provisioned: !!tenant.telroiDomain,","domain: `${tenant.slug}.telroi.ai`, provisioned: tenant.provisionState === 'provisioned',")
if 'TelroiClient.forTenant' not in s:
    s=s.replace("import { TelroiClient } from '~/server/utils/telroi/client';\n","")
open(p,'w').write(s); print("✓ clients/[domain].get.ts")
PY

# --- 7. Delete the now-unreferenced operator.ts -----------------------------
rm -f server/utils/telroi/operator.ts
echo "✓ deleted server/utils/telroi/operator.ts"

echo ""
echo "=== Verify: OperatorClient fully gone? ==="
grep -rn "OperatorClient\|telroi/operator" server/ 2>/dev/null || echo "  ✓ NONE"
echo ""
echo "Now run:  npx nuxi build   → confirm GREEN → commit."
