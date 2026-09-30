-- Per-tenant default for the voice-OTP "do not share this code" notice.
-- API security_notice still overrides per call; this is the default otherwise.
-- Default true preserves current behaviour.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS otp_security_notice boolean NOT NULL DEFAULT true;
