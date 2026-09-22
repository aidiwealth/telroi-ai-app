-- Automatic wallet top-ups (PR #1, cc6fe5b).
--
-- The PR changed schema.ts and shipped no migration, so every query touching
-- payment_methods failed on token_enc — the admin client page among them.
-- Written from the schema diff; run in one transaction so the charge tables
-- land whole or not at all.

-- payments: consent evidence for saving a card
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS save_payment_method_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS save_payment_method_consent_version text,
  ADD COLUMN IF NOT EXISTS save_payment_method_consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS save_payment_method_consented_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS save_payment_method_consented_by_email text;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_save_method_consent_check;
ALTER TABLE payments ADD CONSTRAINT payments_save_method_consent_check CHECK (
  NOT save_payment_method_requested OR (
    save_payment_method_consent_version IS NOT NULL AND
    save_payment_method_consented_at IS NOT NULL AND
    save_payment_method_consented_by_email IS NOT NULL));

-- payment_methods: encrypted token and provider metadata
ALTER TABLE payment_methods ALTER COLUMN token DROP NOT NULL;
ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS token_enc text,
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS provider_signature text,
  ADD COLUMN IF NOT EXISTS source_payment_reference text,
  ADD COLUMN IF NOT EXISTS source_payment_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS reusable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP INDEX IF EXISTS payment_methods_tenant_idx;
CREATE UNIQUE INDEX payment_methods_tenant_idx ON payment_methods (tenant_id);

-- auto_topup_settings
CREATE TABLE IF NOT EXISTS auto_topup_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT false,
  threshold_minor integer NOT NULL,
  topup_amount_minor integer NOT NULL,
  consent_version text,
  consented_at timestamptz,
  consented_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  consented_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_topup_enabled_consent_check CHECK (
    NOT enabled OR (consent_version IS NOT NULL AND consented_at IS NOT NULL AND consented_by_email IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS auto_topup_payment_method_idx ON auto_topup_settings (payment_method_id);

-- auto_topup_attempts: work queue and audit trail for automatic charges
CREATE TABLE IF NOT EXISTS auto_topup_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_ledger_id uuid NOT NULL REFERENCES ledger(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  amount_minor integer NOT NULL,
  currency currency NOT NULL,
  balance_at_trigger_minor integer NOT NULL,
  provider text NOT NULL,
  provider_reference text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  retryable boolean NOT NULL DEFAULT true,
  failure_code text,
  failure_message text,
  cancellation_reason text,
  next_attempt_at timestamptz DEFAULT now(),
  claim_token text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  validated_at timestamptz,
  payment_mode text,
  credential_fingerprint text,
  dispatched_at timestamptz,
  last_attempt_at timestamptz,
  succeeded_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auto_topup_attempts_idempotency_idx ON auto_topup_attempts (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS auto_topup_attempts_trigger_idx ON auto_topup_attempts (trigger_ledger_id);
CREATE UNIQUE INDEX IF NOT EXISTS auto_topup_attempts_payment_idx ON auto_topup_attempts (payment_id);
-- One charge-capable attempt per workspace: two rapid threshold crossings must
-- not become two payments.
CREATE UNIQUE INDEX IF NOT EXISTS auto_topup_attempts_active_tenant_idx ON auto_topup_attempts (tenant_id)
  WHERE status IN ('pending','processing','ready','dispatching','uncertain','needs_review');
CREATE INDEX IF NOT EXISTS auto_topup_attempts_due_idx ON auto_topup_attempts (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS auto_topup_attempts_tenant_created_idx ON auto_topup_attempts (tenant_id, created_at);
