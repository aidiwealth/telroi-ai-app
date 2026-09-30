-- Outbound-only numbers: refuse inbound. Default true so existing numbers keep
-- accepting calls; only lines the client marks outbound-only (e.g. voice OTP)
-- get it turned off.
ALTER TABLE number_subscriptions
  ADD COLUMN IF NOT EXISTS inbound_enabled boolean NOT NULL DEFAULT true;
