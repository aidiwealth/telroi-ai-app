// Direct card-token writes are deliberately disabled. Saved payment methods
// are created only from signature-verified Stripe/Paystack payment webhooks.
import { requireTenantOwner, apiError } from '~/server/utils/api';

export default defineEventHandler(async (event) => {
  await requireTenantOwner(event);
  throw apiError('provider_verification_required',
    'Add or replace a card through a wallet card payment so the provider can verify it.', 405);
});
