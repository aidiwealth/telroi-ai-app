// server/utils/payments.ts
// Paystack (NGN) and Stripe (USD) top-up adapters.
//
// SECURITY: a wallet is credited ONLY when the provider's webhook arrives with
// a VALID SIGNATURE. The browser never credits. init*() just starts a checkout;
// the webhook (verified here) is the source of truth.
import { createHmac, timingSafeEqual } from 'node:crypto';

/* ---------------- Paystack ---------------- */
export const paystack = {
  // Initialize a transaction; returns the hosted checkout URL.
  async init(secretKey: string, email: string, amountMinor: number, reference: string, callbackUrl: string) {
    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, amount: amountMinor, reference, currency: 'NGN', callback_url: callbackUrl })
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Paystack init failed: ${await r.text()}` });
    const j = await r.json();
    return { authorizationUrl: j.data?.authorization_url, reference: j.data?.reference };
  },

  // Verify webhook signature: HMAC-SHA512 of the raw body with the secret key.
  verifySignature(secretKey: string, rawBody: string, signature: string): boolean {
    const hash = createHmac('sha512', secretKey).update(rawBody).digest('hex');
    try { return timingSafeEqual(Buffer.from(hash), Buffer.from(signature || '')); }
    catch { return false; }
  }
};

/* ---------------- Stripe ---------------- */
export const stripe = {
  // Create a Checkout Session for a top-up; returns the hosted URL.
  async init(secretKey: string, amountMinor: number, reference: string, successUrl: string, cancelUrl: string) {
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', successUrl);
    body.set('cancel_url', cancelUrl);
    body.set('client_reference_id', reference);
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][product_data][name]', 'Telroi wallet top-up');
    body.set('line_items[0][price_data][unit_amount]', String(amountMinor));
    body.set('line_items[0][quantity]', '1');
    body.set('metadata[reference]', reference);
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Stripe init failed: ${await r.text()}` });
    const j = await r.json();
    return { authorizationUrl: j.url, reference };
  },

  // Verify Stripe webhook signature (t=...,v1=... scheme over "timestamp.payload").
  verifySignature(signingSecret: string, rawBody: string, sigHeader: string): boolean {
    try {
      const parts = Object.fromEntries((sigHeader || '').split(',').map((p) => p.split('=')));
      const signed = `${parts.t}.${rawBody}`;
      const expected = createHmac('sha256', signingSecret).update(signed).digest('hex');
      return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 || ''));
    } catch { return false; }
  }
};
