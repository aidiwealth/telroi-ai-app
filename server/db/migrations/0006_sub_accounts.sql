-- Sub-accounts: a tenant (e.g. Termii) owns child sub-accounts. Usage is billed
-- to the parent tenant's single wallet; rows carry sub_account_id for reporting
-- and per-sub-account visibility. Nullable everywhere so existing rows and keys
-- (the parent acting directly) are unaffected.

CREATE TABLE IF NOT EXISTS sub_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  reference        text,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sub_accounts_parent_idx ON sub_accounts (parent_tenant_id, created_at);

ALTER TABLE api_keys      ADD COLUMN IF NOT EXISTS sub_account_id uuid;
ALTER TABLE voice_otps    ADD COLUMN IF NOT EXISTS sub_account_id uuid;
ALTER TABLE call_events   ADD COLUMN IF NOT EXISTS sub_account_id uuid;
ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS sub_account_id uuid;

CREATE INDEX IF NOT EXISTS voice_otps_subacct_idx  ON voice_otps  (sub_account_id) WHERE sub_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_events_subacct_idx ON call_events (sub_account_id) WHERE sub_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_contacts_subacct_idx ON crm_contacts (sub_account_id) WHERE sub_account_id IS NOT NULL;
