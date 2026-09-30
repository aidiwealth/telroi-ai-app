-- Per-client overrides: voice-notification unit fee, and VAT rate.
-- Null = fall back to platform default (VAT platform default is 0.075).
ALTER TABLE pricing_overrides
  ADD COLUMN IF NOT EXISTS voice_notify_unit_usd_micro integer,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4);
