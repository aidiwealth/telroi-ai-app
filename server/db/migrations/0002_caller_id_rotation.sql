-- Outbound caller-ID rotation. Per-carrier LRU: each call presents the
-- least-recently-used enabled number, spreading volume to avoid carrier/NCC
-- high-volume blocks. Atomic (FOR UPDATE SKIP LOCKED) so concurrent calls take
-- different numbers. Shared by the dialplan (ODBC_CALLERID_FOR) and the web
-- ownCallerId — one function, one last_used_at state.
ALTER TABLE number_subscriptions
  ADD COLUMN IF NOT EXISTS rotation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE OR REPLACE FUNCTION next_rotating_caller_id(p_tenant uuid, p_provider text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE picked text;
BEGIN
  UPDATE number_subscriptions SET last_used_at = now()
    WHERE id = (
      SELECT id FROM number_subscriptions
      WHERE tenant_id = p_tenant AND provider = p_provider
        AND status = 'active' AND rotation_enabled = true
      ORDER BY last_used_at NULLS FIRST, purchased_at ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING REPLACE(telnum, '+', '') INTO picked;
  RETURN picked;
END $$;
