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
  },

  /** Charge a card we already hold an authorization for — a plan renewal, or
   *  topping a wallet up automatically. No redirect and nothing for the client
   *  to do, which is the whole point of keeping the authorization.
   *
   *  Paystack answers synchronously here, unlike checkout: a success in this
   *  response means the money moved. The webhook still arrives and is still
   *  idempotent on the reference, so the wallet is credited once either way. */
  async chargeAuthorization(secretKey: string, authorizationCode: string, email: string, amountMinor: number, reference: string) {
    const r = await fetch('https://api.paystack.co/transaction/charge_authorization', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorization_code: authorizationCode, email, amount: amountMinor, reference, currency: 'NGN' })
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, reason: j?.message || `paystack_http_${r.status}` };
    // 'success' is paid. Anything else — a declined card, an expired one, a
    // card the bank wants the holder to confirm — is a reason worth keeping.
    if (j?.data?.status !== 'success') return { ok: false, reason: j?.data?.gateway_response || j?.message || 'declined' };
    return { ok: true, reference: j.data.reference };
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

  /** Charge a saved payment method with nobody present.
   *
   *  off_session tells Stripe the cardholder is not here to answer a challenge.
   *  A card that needs one is declined rather than left hanging, and the reason
   *  says so — which is a thing to tell the client rather than retry blindly. */
  async chargeSaved(secretKey: string, paymentMethodId: string, customerId: string | null, amountMinor: number, reference: string) {
    const body = new URLSearchParams();
    body.set('amount', String(amountMinor));
    body.set('currency', 'usd');
    body.set('payment_method', paymentMethodId);
    if (customerId) body.set('customer', customerId);
    body.set('off_session', 'true');
    body.set('confirm', 'true');
    body.set('metadata[reference]', reference);
    const r = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, reason: j?.error?.message || `stripe_http_${r.status}` };
    if (j?.status !== 'succeeded') return { ok: false, reason: j?.last_payment_error?.message || j?.status || 'declined' };
    return { ok: true, reference: j.id };
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
