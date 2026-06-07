// server/utils/integrations/providers.ts
// Provider adapters for CRM/automation integrations. Each adapter implements the
// real third-party API calls behind one interface so the rest of the app
// (import jobs, call logging, click-to-call lookup, Zapier events) is
// provider-agnostic.
//
// Two directions are supported per the product requirement:
//   • import  — pull the CRM's contacts INTO Telroi, and push call activity OUT
//               to the CRM (log calls onto the matching record).
//   • embed   — use Telroi INSIDE the CRM: look up who's calling (screen-pop),
//               and log the call onto the right CRM record. The lookup +
//               logCall methods below are exactly what the in-CRM panel calls.
//
// Credentials are decrypted by the caller and passed in as `creds`.

export interface CrmContactRecord {
  externalId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  url?: string;            // deep link to the record in the CRM
}

export interface CallLogInput {
  phone: string;
  direction: 'inbound' | 'outbound';
  durationSec: number;
  outcome?: string;        // answered | missed | voicemail | busy
  startedAt: Date;
  agent?: string;
  notes?: string;
  recordingUrl?: string;
}

export interface ProviderAdapter {
  /** Verify credentials; throws with a helpful message if invalid. */
  test(creds: any): Promise<{ ok: true; account?: string }>;
  /** Pull a page of contacts from the CRM (import direction). */
  listContacts(creds: any, opts?: { cursor?: string; limit?: number }): Promise<{ contacts: CrmContactRecord[]; nextCursor?: string }>;
  /** Find a contact by phone number (screen-pop / click-to-call lookup). */
  findByPhone(creds: any, phone: string): Promise<CrmContactRecord | null>;
  /** Log a completed call onto the matching CRM record (both directions). */
  logCall(creds: any, call: CallLogInput): Promise<{ ok: boolean; externalId?: string }>;
}

const UA = 'Telroi/1.0 (+https://telroi.ai)';
async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), init.timeoutMs || 15000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
    return res;
  } finally { clearTimeout(to); }
}
function digits(p: string) { return String(p || '').replace(/[^\d]/g, ''); }

// ── HubSpot ────────────────────────────────────────────────────────────────
// Uses a private-app token (Bearer). CRM v3 API.
const hubspot: ProviderAdapter = {
  async test(creds) {
    const res = await http('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
      headers: { Authorization: `Bearer ${creds.apiKey}` }
    });
    if (res.status === 401) throw new Error('HubSpot rejected the token. Check the private-app token and its scopes (crm.objects.contacts read/write).');
    if (!res.ok) throw new Error(`HubSpot error ${res.status}`);
    return { ok: true };
  },
  async listContacts(creds, opts = {}) {
    const limit = Math.min(opts.limit || 100, 100);
    const u = new URL('https://api.hubapi.com/crm/v3/objects/contacts');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('properties', 'firstname,lastname,email,phone,company,jobtitle');
    if (opts.cursor) u.searchParams.set('after', opts.cursor);
    const res = await http(u.toString(), { headers: { Authorization: `Bearer ${creds.apiKey}` } });
    if (!res.ok) throw new Error(`HubSpot list failed ${res.status}`);
    const data: any = await res.json();
    const contacts: CrmContactRecord[] = (data.results || []).map((r: any) => ({
      externalId: r.id,
      firstName: r.properties?.firstname, lastName: r.properties?.lastname,
      name: [r.properties?.firstname, r.properties?.lastname].filter(Boolean).join(' ') || undefined,
      email: r.properties?.email, phone: r.properties?.phone,
      company: r.properties?.company, title: r.properties?.jobtitle,
      url: `https://app.hubspot.com/contacts/_/contact/${r.id}`
    }));
    return { contacts, nextCursor: data.paging?.next?.after };
  },
  async findByPhone(creds, phone) {
    const res = await http('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: digits(phone).slice(-9) }] }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'company'], limit: 1
      })
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const r = (data.results || [])[0];
    if (!r) return null;
    return { externalId: r.id, name: [r.properties?.firstname, r.properties?.lastname].filter(Boolean).join(' ') || undefined, email: r.properties?.email, phone: r.properties?.phone, company: r.properties?.company, url: `https://app.hubspot.com/contacts/_/contact/${r.id}` };
  },
  async logCall(creds, call) {
    // Create a Call engagement (CRM v3 calls object).
    const res = await http('https://api.hubapi.com/crm/v3/objects/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: {
          hs_timestamp: call.startedAt.getTime(),
          hs_call_title: `Telroi ${call.direction} call`,
          hs_call_body: call.notes || `Outcome: ${call.outcome || 'completed'}`,
          hs_call_duration: String(call.durationSec * 1000),
          hs_call_direction: call.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND',
          hs_call_status: 'COMPLETED',
          hs_call_from_number: call.direction === 'outbound' ? '' : call.phone,
          hs_call_to_number: call.direction === 'outbound' ? call.phone : ''
        }
      })
    });
    if (!res.ok) throw new Error(`HubSpot logCall failed ${res.status}`);
    const data: any = await res.json();
    return { ok: true, externalId: data.id };
  }
};

// ── Pipedrive ──────────────────────────────────────────────────────────────
// Uses an API token (query param) against the company domain or api.pipedrive.com.
function pdBase(creds: any) { return (creds.domain ? `https://${creds.domain}.pipedrive.com` : 'https://api.pipedrive.com'); }
const pipedrive: ProviderAdapter = {
  async test(creds) {
    const res = await http(`${pdBase(creds)}/v1/users/me?api_token=${encodeURIComponent(creds.apiKey)}`);
    if (res.status === 401) throw new Error('Pipedrive rejected the API token.');
    if (!res.ok) throw new Error(`Pipedrive error ${res.status}`);
    const data: any = await res.json();
    return { ok: true, account: data?.data?.name };
  },
  async listContacts(creds, opts = {}) {
    const start = opts.cursor ? parseInt(opts.cursor, 10) : 0;
    const limit = Math.min(opts.limit || 100, 100);
    const res = await http(`${pdBase(creds)}/v1/persons?start=${start}&limit=${limit}&api_token=${encodeURIComponent(creds.apiKey)}`);
    if (!res.ok) throw new Error(`Pipedrive list failed ${res.status}`);
    const data: any = await res.json();
    const contacts: CrmContactRecord[] = (data.data || []).map((r: any) => ({
      externalId: String(r.id), name: r.name,
      email: (r.email || []).find((e: any) => e.primary)?.value || (r.email || [])[0]?.value,
      phone: (r.phone || []).find((p: any) => p.primary)?.value || (r.phone || [])[0]?.value,
      company: r.org_name, url: `${pdBase(creds)}/person/${r.id}`
    }));
    const more = data.additional_data?.pagination?.more_items_in_collection;
    const nextStart = data.additional_data?.pagination?.next_start;
    return { contacts, nextCursor: more ? String(nextStart) : undefined };
  },
  async findByPhone(creds, phone) {
    const res = await http(`${pdBase(creds)}/v1/persons/search?term=${encodeURIComponent(digits(phone).slice(-9))}&fields=phone&limit=1&api_token=${encodeURIComponent(creds.apiKey)}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const item = data?.data?.items?.[0]?.item;
    if (!item) return null;
    return { externalId: String(item.id), name: item.name, phone: (item.phones || [])[0], url: `${pdBase(creds)}/person/${item.id}` };
  },
  async logCall(creds, call) {
    // Pipedrive logs calls as Activities (type 'call').
    const res = await http(`${pdBase(creds)}/v1/activities?api_token=${encodeURIComponent(creds.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: `Telroi ${call.direction} call (${call.outcome || 'completed'})`,
        type: 'call', done: 1,
        due_date: call.startedAt.toISOString().slice(0, 10),
        note: `${call.notes || ''}\nDuration: ${call.durationSec}s${call.recordingUrl ? `\nRecording: ${call.recordingUrl}` : ''}`.trim()
      })
    });
    if (!res.ok) throw new Error(`Pipedrive logCall failed ${res.status}`);
    const data: any = await res.json();
    return { ok: true, externalId: String(data?.data?.id || '') };
  }
};

// ── Zoho CRM ───────────────────────────────────────────────────────────────
// Uses an OAuth access token (Zoho-oauthtoken). dc = data center (com/eu/in/...).
function zohoBase(creds: any) { return `https://www.zohoapis.${creds.dc || 'com'}/crm/v5`; }
const zoho: ProviderAdapter = {
  async test(creds) {
    const res = await http(`${zohoBase(creds)}/Contacts?per_page=1`, { headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}` } });
    if (res.status === 401) throw new Error('Zoho rejected the access token (it may have expired — reconnect).');
    if (!res.ok && res.status !== 204) throw new Error(`Zoho error ${res.status}`);
    return { ok: true };
  },
  async listContacts(creds, opts = {}) {
    const page = opts.cursor ? parseInt(opts.cursor, 10) : 1;
    const perPage = Math.min(opts.limit || 100, 200);
    const res = await http(`${zohoBase(creds)}/Contacts?page=${page}&per_page=${perPage}&fields=Full_Name,First_Name,Last_Name,Email,Phone,Mobile,Account_Name,Title`, {
      headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}` }
    });
    if (res.status === 204) return { contacts: [] };
    if (!res.ok) throw new Error(`Zoho list failed ${res.status}`);
    const data: any = await res.json();
    const contacts: CrmContactRecord[] = (data.data || []).map((r: any) => ({
      externalId: String(r.id), name: r.Full_Name, firstName: r.First_Name, lastName: r.Last_Name,
      email: r.Email, phone: r.Phone || r.Mobile, company: r.Account_Name?.name, title: r.Title,
      url: `https://crm.zoho.${creds.dc || 'com'}/crm/tab/Contacts/${r.id}`
    }));
    return { contacts, nextCursor: data.info?.more_records ? String(page + 1) : undefined };
  },
  async findByPhone(creds, phone) {
    const tail = digits(phone).slice(-9);
    const res = await http(`${zohoBase(creds)}/Contacts/search?phone=${encodeURIComponent(tail)}`, { headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}` } });
    if (!res.ok || res.status === 204) return null;
    const data: any = await res.json();
    const r = (data.data || [])[0];
    if (!r) return null;
    return { externalId: String(r.id), name: r.Full_Name, email: r.Email, phone: r.Phone || r.Mobile, company: r.Account_Name?.name, url: `https://crm.zoho.${creds.dc || 'com'}/crm/tab/Contacts/${r.id}` };
  },
  async logCall(creds, call) {
    const res = await http(`${zohoBase(creds)}/Calls`, {
      method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{
          Subject: `Telroi ${call.direction} call`,
          Call_Type: call.direction === 'inbound' ? 'Inbound' : 'Outbound',
          Call_Start_Time: call.startedAt.toISOString(),
          Call_Duration: `${Math.floor(call.durationSec / 60)}:${String(call.durationSec % 60).padStart(2, '0')}`,
          Description: `${call.notes || ''} (${call.outcome || 'completed'})`.trim(),
          Call_Result: call.outcome || 'Completed'
        }]
      })
    });
    if (!res.ok) throw new Error(`Zoho logCall failed ${res.status}`);
    const data: any = await res.json();
    return { ok: true, externalId: String(data?.data?.[0]?.details?.id || '') };
  }
};

// ── Zapier (automation, not a CRM) ───────────────────────────────────────────
// Zapier is event-driven: Telroi pushes events to Zapier hook URLs (see
// integrationEvents + events.ts). There's no contact list to import, so the CRM
// methods are no-ops; test() just confirms a hook URL is reachable shape-wise.
const zapier: ProviderAdapter = {
  async test() { return { ok: true }; },
  async listContacts() { return { contacts: [] }; },
  async findByPhone() { return null; },
  async logCall() { return { ok: false }; }
};

const ADAPTERS: Record<string, ProviderAdapter> = { hubspot, pipedrive, zoho, zapier };
export function adapterFor(provider: string): ProviderAdapter | null { return ADAPTERS[provider] || null; }
export const SUPPORTED_PROVIDERS = ['zapier', 'pipedrive', 'hubspot', 'zoho'] as const;
export type IntegrationProvider = typeof SUPPORTED_PROVIDERS[number];
