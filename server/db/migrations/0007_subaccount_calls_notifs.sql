ALTER TABLE voice_notifications ADD COLUMN IF NOT EXISTS sub_account_id uuid;
CREATE INDEX IF NOT EXISTS voice_notifs_subacct_idx ON voice_notifications (sub_account_id) WHERE sub_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS call_subaccount_map (
  callid         text PRIMARY KEY,
  sub_account_id uuid NOT NULL,
  tenant_id      uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
