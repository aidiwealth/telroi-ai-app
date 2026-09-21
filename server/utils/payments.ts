// server/utils/payments.ts
// Paystack (NGN) and Stripe (USD) top-up adapters.
//
// SECURITY: a wallet is credited ONLY when the provider's webhook arrives with
// a VALID SIGNATURE. The browser never credits. init*() just starts a checkout;
// the webhook (verified here) is the source of truth.
import { createHmac, timingSafeEqual } from 'node:crypto';

// Pin raw Stripe HTTP calls to the API contract covered by our parsers/tests.
// The Stripe webhook endpoint must be configured to emit this same version.
export const STRIPE_API_VERSION = '2026-02-25.clover';
export const STRIPE_MAX_AMOUNT_MINOR = 99_999_999;

/* ---------------- Paystack ---------------- */
export const paystack = {
  // Initialize a transaction; returns the hosted checkout URL.
  async init(secretKey: string, email: string, amountMinor: number, reference: string,
    callbackUrl: string, savePaymentMethod = false) {
    const body: Record<string, unknown> = {
      email, amount: String(amountMinor), reference, currency: 'NGN', callback_url: callbackUrl
    };
    // Saving is card-only in this release. Ordinary top-ups retain Paystack's
    // configured channel choices, including bank and transfer methods.
    if (savePaymentMethod) body.channels = ['card'];
    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
      body: JSON.stringify({ authorization_code: authorizationCode, email,
        amount: String(amountMinor), reference, currency: 'NGN' })
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
  async init(secretKey: string, amountMinor: number, reference: string, successUrl: string, cancelUrl: string,
    customerId?: string | null, savePaymentMethod = false) {
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    // Automatic top-up setup must produce a card PaymentMethod. Ordinary wallet
    // funding can also use Link, which settles immediately but is not presented
    // to this application as a saved card. Delayed bank methods need a separate
    // settlement flow and therefore are deliberately not offered here.
    body.append('payment_method_types[]', 'card');
    if (!savePaymentMethod) body.append('payment_method_types[]', 'link');
    body.set('success_url', successUrl);
    body.set('cancel_url', cancelUrl);
    body.set('client_reference_id', reference);
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][product_data][name]', 'Telroi wallet top-up');
    body.set('line_items[0][price_data][unit_amount]', String(amountMinor));
    body.set('line_items[0][quantity]', '1');
    body.set('metadata[reference]', reference);
    body.set('payment_intent_data[metadata][reference]', reference);
    if (savePaymentMethod) {
      // Checkout also displays its future-use notice. The application records
      // the owner's choice separately on the pending payment for webhook gating.
      body.set('payment_intent_data[setup_future_usage]', 'off_session');
      if (customerId) body.set('customer', customerId);
      else body.set('customer_creation', 'always');
    } else if (customerId) {
      // Allow an existing Customer to use its saved methods without retaining
      // or replacing the new method used for this ordinary payment.
      body.set('customer', customerId);
    }
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION },
      body
    });
    if (!r.ok) throw createError({ statusCode: r.status, message: `Stripe init failed: ${await r.text()}` });
    const j = await r.json();
    return { authorizationUrl: j.url, reference };
  },

  /** Retrieve the PaymentIntent and expand the reusable PaymentMethod captured
   * by Checkout. Webhook payloads normally contain only the intent id. */
  async retrievePaymentIntent(secretKey: string, paymentIntentId: string) {
    const url = new URL(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
    url.searchParams.append('expand[]', 'payment_method');
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': STRIPE_API_VERSION }
    });
    if (!r.ok) throw new Error(`Stripe PaymentIntent lookup failed: ${r.status} ${await r.text()}`);
    return await r.json() as any;
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
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // A caller retrying this persisted operation must receive the original
        // PaymentIntent instead of creating a second real charge.
        'Idempotency-Key': reference,
        'Stripe-Version': STRIPE_API_VERSION
      },
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
      const parts = (sigHeader || '').split(',').map(p => p.trim().split('='));
      const timestamps = parts.filter(([key]) => key === 't');
      const timestamp = timestamps[0]?.[1];
      if (timestamps.length !== 1 || !timestamp || !/^\d+$/.test(timestamp) ||
          Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
      const signed = `${timestamp}.${rawBody}`;
      const expected = createHmac('sha256', signingSecret).update(signed).digest('hex');
      return parts.some(([key, value]) => key === 'v1' && !!value && /^[a-f0-9]{64}$/.test(value) &&
        timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(value, 'hex')));
    } catch { return false; }
  }
};
