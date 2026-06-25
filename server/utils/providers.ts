// server/utils/providers.ts
// Voice-carrier adapters for Twilio and Telnyx. Each exposes a tiny surface:
//   testCreds()  — prove the credentials work (cheap authed call)
//   makeCall()   — originate an outbound call
// Inbound calls arrive via each provider's webhook (see server/api/providers/*).
//
// Credentials are stored encrypted (voiceProviders.credentialsEnc) as a JSON blob.

export interface TwilioCreds { accountSid: string; authToken: string; fromNumber?: string }
export interface TelnyxCreds { apiKey: string; connectionId?: string; fromNumber?: string }

/* ---------------- Twilio ---------------- */
export const twilio = {
  async testCreds(c: TwilioCreds) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64') }
    });
    return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
  },
  // Click-to-call: rings `to`, and on answer fetches TwiML from `voiceUrl`.
  async makeCall(c: TwilioCreds, to: string, voiceUrl: string) {
    const body = new URLSearchParams({ To: to, From: c.fromNumber || '', Url: voiceUrl });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Twilio call failed: ${await r.text()}` });
    const j = await r.json();
    return { callid: j.sid, status: j.status };
  },

  // ── Elastic SIP Trunking (real API: https://trunking.twilio.com/v1) ──
  // Creates a Trunk (TK…) the client points their SIP gear at. Auth via the
  // platform master account; the trunk's termination domain ends in
  // pstn.twilio.com per Twilio's spec.
  async createSipTrunk(c: TwilioCreds, friendlyName: string, domainLabel: string) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    const body = new URLSearchParams({ FriendlyName: friendlyName, DomainName: `${domainLabel}.pstn.twilio.com`, Secure: 'true' });
    const r = await fetch('https://trunking.twilio.com/v1/Trunks', {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Twilio trunk create failed: ${await r.text()}` });
    const j = await r.json();
    return { sid: j.sid, domainName: j.domain_name, secure: j.secure, friendlyName: j.friendly_name };
  },
  async listSipTrunks(c: TwilioCreds) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    const r = await fetch('https://trunking.twilio.com/v1/Trunks', { headers: { Authorization: auth } });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Twilio trunk list failed: HTTP ${r.status}` });
    const j = await r.json();
    return (j.trunks || []).map((t: any) => ({ sid: t.sid, domainName: t.domain_name, friendlyName: t.friendly_name, secure: t.secure }));
  },
  async deleteSipTrunk(c: TwilioCreds, sid: string) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    const r = await fetch(`https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(sid)}`, { method: 'DELETE', headers: { Authorization: auth } });
    if (!r.ok && r.status !== 404) throw createError({ statusCode: r.status, message: `Twilio trunk delete failed: HTTP ${r.status}` });
    return { ok: true };
  },

  // Create an account-level SIP Credential List, add a username/password
  // credential to it, then associate the list with the trunk. This is what lets
  // a client's SIP device authenticate by username + password.
  async createTrunkCredential(c: TwilioCreds, trunkSid: string, friendlyName: string, username: string, password: string) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    const acctBase = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}`;
    // 1) create the credential list
    const clRes = await fetch(`${acctBase}/SIP/CredentialLists.json`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ FriendlyName: friendlyName })
    });
    if (!clRes.ok) throw createError({ statusCode: clRes.status, message: `Twilio credential list failed: ${await clRes.text()}` });
    const cl = await clRes.json();
    const credListSid = cl.sid;
    // 2) add the username/password credential
    const credRes = await fetch(`${acctBase}/SIP/CredentialLists/${credListSid}/Credentials.json`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ Username: username, Password: password })
    });
    if (!credRes.ok) throw createError({ statusCode: credRes.status, message: `Twilio credential add failed: ${await credRes.text()}` });
    // 3) associate the list with the trunk
    const assocRes = await fetch(`https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunkSid)}/CredentialLists`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CredentialListSid: credListSid })
    });
    if (!assocRes.ok) throw createError({ statusCode: assocRes.status, message: `Twilio credential assoc failed: ${await assocRes.text()}` });
    return { credentialListSid: credListSid, username };
  },

  // Look up a phone number's SID, then associate it with a trunk so inbound
  // calls to that number are delivered over the SIP trunk. Explicit action.
  async attachNumberToTrunk(c: TwilioCreds, trunkSid: string, e164: string) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    const acctBase = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}`;
    const look = await fetch(`${acctBase}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}`, { headers: { Authorization: auth } });
    if (!look.ok) throw createError({ statusCode: look.status, message: `Twilio number lookup failed: HTTP ${look.status}` });
    const lj = await look.json();
    const pnSid = lj.incoming_phone_numbers?.[0]?.sid;
    if (!pnSid) throw createError({ statusCode: 404, message: 'That number was not found on the Twilio account.' });
    const assoc = await fetch(`https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunkSid)}/PhoneNumbers`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumberSid: pnSid })
    });
    if (!assoc.ok) throw createError({ statusCode: assoc.status, message: `Twilio number attach failed: ${await assoc.text()}` });
    return { ok: true, phoneNumberSid: pnSid };
  }
};

/* ---------------- Telnyx ---------------- */
export const telnyx = {
  async testCreds(c: TelnyxCreds) {
    const r = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=1', {
      headers: { Authorization: `Bearer ${c.apiKey}` }
    });
    return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
  },
  async makeCall(c: TelnyxCreds, to: string) {
    const r = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: c.connectionId, to, from: c.fromNumber })
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Telnyx call failed: ${await r.text()}` });
    const j = await r.json();
    return { callid: j.data?.call_control_id, status: 'initiated' };
  },

  // ── SIP Connections (real API: https://api.telnyx.com/v2) ──
  // A credential connection authenticates the client's SIP device against
  // sip.telnyx.com. Per-device logins are minted as telephony_credentials.
  async createCredentialConnection(c: TelnyxCreds, name: string) {
    const r = await fetch('https://api.telnyx.com/v2/credential_connections', {
      method: 'POST', headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_name: name })
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Telnyx connection create failed: ${await r.text()}` });
    const j = await r.json();
    return { id: j.data?.id, name: j.data?.connection_name };
  },
  async listConnections(c: TelnyxCreds) {
    const r = await fetch('https://api.telnyx.com/v2/credential_connections?page[size]=50', { headers: { Authorization: `Bearer ${c.apiKey}` } });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Telnyx connection list failed: HTTP ${r.status}` });
    const j = await r.json();
    return (j.data || []).map((d: any) => ({ id: d.id, name: d.connection_name }));
  },
  // Mint a device login on a connection. Telnyx returns the generated
  // sip_username / sip_password (shown once to the client, stored encrypted).
  async createTelephonyCredential(c: TelnyxCreds, connectionId: string, name: string) {
    const r = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
      method: 'POST', headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connectionId, name })
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Telnyx credential create failed: ${await r.text()}` });
    const j = await r.json();
    return { id: j.data?.id, sipUsername: j.data?.sip_username, sipPassword: j.data?.sip_password, name: j.data?.name };
  },
  async deleteConnection(c: TelnyxCreds, id: string) {
    const r = await fetch(`https://api.telnyx.com/v2/credential_connections/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${c.apiKey}` } });
    if (!r.ok && r.status !== 404) throw createError({ statusCode: r.status, message: `Telnyx connection delete failed: HTTP ${r.status}` });
    return { ok: true };
  },

  // Route an existing Telnyx number to a connection. Telnyx keys numbers by an
  // internal id, so resolve the E.164 to its id first, then PATCH connection_id.
  // (Verified: GET /v2/phone_numbers?filter[phone_number]=… → PATCH /v2/phone_numbers/{id})
  async attachNumberToConnection(c: TelnyxCreds, connectionId: string, e164: string) {
    const look = await fetch(`https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(e164)}`, { headers: { Authorization: `Bearer ${c.apiKey}` } });
    if (!look.ok) throw createError({ statusCode: look.status, message: `Telnyx number lookup failed: HTTP ${look.status}` });
    const lj = await look.json();
    const numId = lj.data?.[0]?.id;
    if (!numId) throw createError({ statusCode: 404, message: 'That number was not found on the Telnyx account.' });
    const patch = await fetch(`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(numId)}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connectionId })
    });
    if (!patch.ok) throw createError({ statusCode: patch.status, message: `Telnyx number assign failed: ${await patch.text()}` });
    return { ok: true, numberId: numId };
  }
};

export async function testProvider(kind: string, creds: any) {
  if (kind === 'twilio') return twilio.testCreds(creds);
  if (kind === 'telnyx') return telnyx.testCreds(creds);
  return { ok: false, detail: 'Unsupported provider' };
}


// ── Number provisioning (allocate a number on the carrier) ──
// Built to each carrier's documented API. Unverified against live accounts from
// the build env; errors surface to the operator rather than being swallowed.
export const twilioProvision = {
  // Search the master Twilio account for purchasable numbers by country + filters.
  // Returns a normalized list the admin can pick from.
  async searchAvailable(c: TwilioCreds, opts: { country: string; areaCode?: string; contains?: string; limit?: number }) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    const params = new URLSearchParams({ PageSize: String(opts.limit || 20) });
    if (opts.areaCode) params.set('AreaCode', opts.areaCode);
    if (opts.contains) params.set('Contains', opts.contains);
    const country = (opts.country || 'US').toUpperCase();
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${params}`, {
      headers: { Authorization: auth }
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Twilio search failed: ${await r.text()}` });
    const j = await r.json();
    return (j.available_phone_numbers || []).map((n: any) => ({
      telnum: n.phone_number, region: country, locality: n.locality || n.region || '', provider: 'twilio'
    }));
  },
  // Purchase an incoming phone number on the master Twilio account.
  async buyNumber(c: TwilioCreds, telnum: string) {
    const body = new URLSearchParams({ PhoneNumber: telnum });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Twilio provision failed: ${await r.text()}` });
    const j = await r.json();
    return { ref: j.sid as string };
  },
  // Point the number's inbound Voice URL (+ status callback) at our webhook.
  async setVoiceWebhook(c: TwilioCreds, telnum: string, url: string) {
    const auth = 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
    // Find the number's SID.
    const look = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(telnum)}`, { headers: { Authorization: auth } });
    if (!look.ok) throw new Error(`Twilio lookup failed: ${await look.text()}`);
    const sid = (await look.json())?.incoming_phone_numbers?.[0]?.sid;
    if (!sid) throw new Error('Number SID not found on Twilio');
    const body = new URLSearchParams({ VoiceUrl: url, VoiceMethod: 'POST', StatusCallback: url, StatusCallbackMethod: 'POST' });
    const upd = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers/${sid}.json`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    if (!upd.ok) throw new Error(`Twilio webhook set failed: ${await upd.text()}`);
    return true;
  }
};

export const telnyxProvision = {
  // Search Telnyx for purchasable numbers by country + filters.
  async searchAvailable(c: TelnyxCreds, opts: { country: string; areaCode?: string; contains?: string; limit?: number }) {
    const params = new URLSearchParams();
    params.set('filter[country_code]', (opts.country || 'US').toUpperCase());
    params.set('filter[limit]', String(opts.limit || 20));
    if (opts.areaCode) params.set('filter[national_destination_code]', opts.areaCode);
    if (opts.contains) params.set('filter[phone_number][contains]', opts.contains);
    const r = await fetch(`https://api.telnyx.com/v2/available_phone_numbers?${params}`, {
      headers: { Authorization: `Bearer ${c.apiKey}` }
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Telnyx search failed: ${await r.text()}` });
    const j = await r.json();
    return (j.data || []).map((n: any) => ({
      telnum: n.phone_number, region: (opts.country || 'US').toUpperCase(),
      locality: n.region_information?.[0]?.region_name || '', provider: 'telnyx'
    }));
  },
  // Telnyx uses number-order objects; this creates an order for the number.
  async buyNumber(c: TelnyxCreds, telnum: string) {
    const r = await fetch('https://api.telnyx.com/v2/number_orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_numbers: [{ phone_number: telnum }] })
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Telnyx provision failed: ${await r.text()}` });
    const j = await r.json();
    return { ref: j.data?.id as string };
  },
  // Telnyx routes inbound events via the Call Control App / connection webhook.
  // Set the connection's webhook URL so events for this number reach us.
  async setVoiceWebhook(c: TelnyxCreds, telnum: string, url: string) {
    if (!c.connectionId) throw new Error('Telnyx connectionId not configured');
    const r = await fetch(`https://api.telnyx.com/v2/call_control_applications/${c.connectionId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_event_url: url })
    });
    if (!r.ok) throw new Error(`Telnyx webhook set failed: ${await r.text()}`);
    return true;
  }
};
