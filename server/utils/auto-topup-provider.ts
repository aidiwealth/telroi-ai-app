import { z } from 'zod';
import { STRIPE_API_VERSION, STRIPE_MAX_AMOUNT_MINOR } from './payments';

export type AutoTopupProvider = 'stripe' | 'paystack';
export type PaymentObservation = {
  outcome: 'succeeded' | 'failed' | 'pending';
  provider: AutoTopupProvider;
  providerId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  mode: 'test' | 'live';
  code: string;
};
export type ProviderResult = PaymentObservation | { outcome: 'unknown'; code: string };

const StripeIntent = z.object({
  id: z.string().regex(/^pi_/), amount: z.number().int().positive(),
  amount_received: z.number().int().nonnegative(), currency: z.string(),
  livemode: z.boolean(), status: z.enum(['succeeded', 'canceled', 'requires_payment_method',
    'requires_action', 'requires_confirmation', 'requires_capture', 'processing']),
  metadata: z.object({ reference: z.string().min(1) }),
  last_payment_error: z.object({ code: z.string().optional() }).nullish()
});
const PaystackTransaction = z.object({
  id: z.union([z.number().int(), z.string().min(1)]), reference: z.string().min(1),
  amount: z.number().int().positive(), currency: z.string(), channel: z.literal('card'),
  domain: z.enum(['test', 'live']), status: z.enum(['success', 'failed', 'abandoned', 'ongoing',
    'pending', 'processing', 'queued', 'reversed'])
});

/** Accept only provider evidence with identity, exact amount and mode. Never
 * persist raw errors: they can include client secrets and authorization codes. */
export function stripeObservation(input: unknown): ProviderResult {
  const parsed = StripeIntent.safeParse(input);
  if (!parsed.success) return { outcome: 'unknown', code: 'invalid_stripe_response' };
  const p = parsed.data;
  if (p.status === 'succeeded' && p.amount_received !== p.amount) {
    return { outcome: 'unknown', code: 'stripe_amount_received_mismatch' };
  }
  const authenticationRequired = p.status === 'requires_action'
    || (p.status === 'requires_payment_method' && p.last_payment_error?.code === 'authentication_required');
  return {
    outcome: p.status === 'succeeded' ? 'succeeded'
      : p.status === 'canceled' || p.status === 'requires_action'
        || (p.status === 'requires_payment_method' && !!p.last_payment_error) ? 'failed' : 'pending',
    provider: 'stripe', providerId: p.id, reference: p.metadata.reference,
    amountMinor: p.amount, currency: p.currency.toUpperCase(), mode: p.livemode ? 'live' : 'test',
    code: authenticationRequired ? 'authentication_required' : `stripe_${p.status}`
  };
}

export function paystackObservation(input: unknown): ProviderResult {
  const parsed = PaystackTransaction.safeParse(input);
  if (!parsed.success) return { outcome: 'unknown', code: 'invalid_paystack_response' };
  const p = parsed.data;
  return {
    outcome: p.status === 'success' ? 'succeeded'
      : ['failed', 'abandoned', 'reversed'].includes(p.status) ? 'failed' : 'pending',
    provider: 'paystack', providerId: String(p.id), reference: p.reference,
    amountMinor: p.amount, currency: p.currency.toUpperCase(), mode: p.domain,
    code: `paystack_${p.status}`
  };
}

type DispatchInput = {
  provider: AutoTopupProvider; secret: string; reference: string; amountMinor: number;
  currency: 'USD' | 'NGN'; token: string; customerId: string | null; billingEmail: string | null;
};
const REQUEST_TIMEOUT_MS = 20_000;

/** One POST per durable dispatch. Transport/HTTP/parse failures are unknown,
 * never permission to submit another charge, even with the same reference. */
export async function dispatchProviderCharge(input: DispatchInput): Promise<ProviderResult> {
  try {
    if (input.provider === 'stripe') {
      if (input.currency !== 'USD' || !input.customerId || input.amountMinor > STRIPE_MAX_AMOUNT_MINOR) {
        throw new Error('invalid card context');
      }
      const body = new URLSearchParams({
        amount: String(input.amountMinor), currency: 'usd', payment_method: input.token,
        customer: input.customerId, off_session: 'true', confirm: 'true', error_on_requires_action: 'true',
        'payment_method_types[0]': 'card', 'metadata[reference]': input.reference
      });
      const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${input.secret}`, 'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': input.reference, 'Stripe-Version': STRIPE_API_VERSION }, body
      });
      const data = await response.json();
      // A decline can return HTTP 402 with the actual PaymentIntent attached.
      return stripeObservation(response.ok ? data : data?.error?.payment_intent);
    }
    if (input.currency !== 'NGN' || !input.billingEmail) throw new Error('invalid card context');
    const response = await fetch('https://api.paystack.co/transaction/charge_authorization', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${input.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorization_code: input.token, email: input.billingEmail,
        amount: String(input.amountMinor), currency: 'NGN', reference: input.reference, queue: true })
    });
    const data = await response.json();
    if (!response.ok || data?.status !== true) return { outcome: 'unknown', code: 'paystack_request_unconfirmed' };
    return paystackObservation(data.data);
  } catch {
    return { outcome: 'unknown', code: 'provider_request_unconfirmed' };
  }
}

/** Recovery is GET-only. A missing/search-delayed transaction remains unknown.
 * In particular, Stripe search is eventually consistent and its idempotency
 * keys expire: neither a missing result nor an old key permits a new POST. */
export async function verifyProviderCharge(input: {
  provider: AutoTopupProvider; secret: string; reference: string; providerId: string | null;
}): Promise<ProviderResult> {
  try {
    let url: URL;
    if (input.provider === 'paystack') {
      url = new URL(`https://api.paystack.co/transaction/verify/${encodeURIComponent(input.reference)}`);
    } else if (input.providerId) {
      url = new URL(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(input.providerId)}`);
    } else {
      if (!/^[a-zA-Z0-9_:-]+$/.test(input.reference)) return { outcome: 'unknown', code: 'invalid_reference' };
      url = new URL('https://api.stripe.com/v1/payment_intents/search');
      url.searchParams.set('query', `metadata['reference']:'${input.reference}'`);
      url.searchParams.set('limit', '2');
    }
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${input.secret}`,
        ...(input.provider === 'stripe' ? { 'Stripe-Version': STRIPE_API_VERSION } : {}) } });
    if (!response.ok) return { outcome: 'unknown', code: 'verification_unavailable' };
    const data = await response.json();
    if (input.provider === 'paystack') return data?.status === true
      ? paystackObservation(data.data) : { outcome: 'unknown', code: 'verification_unavailable' };
    if (input.providerId) return stripeObservation(data);
    if (!Array.isArray(data?.data) || data.data.length !== 1 || data.has_more) {
      return { outcome: 'unknown', code: 'stripe_search_inconclusive' };
    }
    return stripeObservation(data.data[0]);
  } catch {
    return { outcome: 'unknown', code: 'verification_unavailable' };
  }
}
