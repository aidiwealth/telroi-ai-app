// server/utils/monnify.ts
// Monnify integration for Nigerian bank-transfer top-ups via dedicated
// (reserved) virtual accounts. One reserved account per workspace; the user
// transfers into it and the wallet credits when Monnify's webhook confirms.
//
// Verified against Monnify docs:
//  - Auth: Basic (apiKey:secretKey base64) -> bearer access token
//  - Reserve: POST {base}/api/v2/bank-transfer/reserved-accounts (Moniepoint default)
//  - Webhook: 'monnify-signature' header = HMAC-SHA512(rawBody, clientSecret) hex
import { createHmac, timingSafeEqual } from 'node:crypto';

function base(env: string) {
  return env === 'live' ? 'https://api.monnify.com' : 'https://sandbox.monnify.com';
}

export const monnify = {
  // Exchange API key + secret for a short-lived bearer token.
  async token(apiKey: string, secretKey: string, env: string): Promise<string> {
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    const r = await fetch(`${base(env)}/api/v1/auth/login`, {
      method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Monnify auth failed: ${await r.text()}` });
    const j = await r.json();
    const tok = j?.responseBody?.accessToken;
    if (!tok) throw createError({ statusCode: 502, message: 'Monnify auth: no access token' });
    return tok;
  },

  // Reserve a dedicated account for a workspace. Returns the account(s) —
  // Moniepoint MFB is the default partner bank.
  async reserveAccount(opts: {
    apiKey: string; secretKey: string; env: string; contractCode: string;
    accountReference: string; accountName: string; customerEmail: string;
    customerName: string; bvn?: string; nin?: string;
  }) {
    const token = await this.token(opts.apiKey, opts.secretKey, opts.env);
    const body: Record<string, unknown> = {
      accountReference: opts.accountReference,
      accountName: opts.accountName,
      currencyCode: 'NGN',
      contractCode: opts.contractCode,
      customerEmail: opts.customerEmail,
      customerName: opts.customerName,
      getAllAvailableBanks: false // Moniepoint default
    };
    // CBN compliance: a BVN or NIN must be attached to virtual accounts.
    if (opts.bvn) body.bvn = opts.bvn;
    if (opts.nin) body.nin = opts.nin;

    const r = await fetch(`${base(opts.env)}/api/v2/bank-transfer/reserved-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Monnify reserve failed: ${await r.text()}` });
    const j = await r.json();
    const rb = j?.responseBody || {};
    // accounts[] carries {bankName, bankCode, accountNumber, accountName}
    return {
      accountReference: rb.accountReference,
      reservationReference: rb.reservationReference,
      accounts: rb.accounts || [],
      // Convenience: the first (default Moniepoint) account
      primary: (rb.accounts && rb.accounts[0]) || null
    };
  },

  // Verify a webhook: HMAC-SHA512 of the RAW body keyed with the client secret.
  verifySignature(clientSecret: string, rawBody: string, signature: string): boolean {
    const computed = createHmac('sha512', clientSecret).update(rawBody, 'utf8').digest('hex');
    try { return timingSafeEqual(Buffer.from(computed), Buffer.from(signature || '')); }
    catch { return false; }
  }
};
