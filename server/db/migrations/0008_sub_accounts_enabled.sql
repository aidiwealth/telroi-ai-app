ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sub_accounts_enabled boolean NOT NULL DEFAULT false;
UPDATE tenants SET sub_accounts_enabled = true WHERE id = '4a65a21b-70c9-46c1-ad32-4754f3a13d30';
