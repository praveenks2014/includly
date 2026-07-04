-- 0033_upi_verification.sql
-- Adds server-only tracking columns for the ₹1 reverse-penny-drop UPI
-- verification flow. `upi_vpa` already exists (previously unused) and is
-- repurposed as the verified-VPA column; payout code paths already read
-- only from `upi_vpa`.

ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS upi_verification_payment_id text,
  ADD COLUMN IF NOT EXISTS upi_verified_at timestamptz;
