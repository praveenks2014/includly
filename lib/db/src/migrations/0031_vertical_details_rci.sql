-- Adds three new nullable columns to professional_profiles.
-- No existing column is renamed or dropped.
-- vertical_details: JSONB bag for per-vertical onboarding answers that have
--   no dedicated column (e.g. board exam details for therapists, school name
--   for shadow teachers). Shape is validated in application code, not DB.
-- rci_crr_number / rci_verified: Rehabilitation Council of India credential
--   fields; separate from the existing verification_status flow.

ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS vertical_details   jsonb,
  ADD COLUMN IF NOT EXISTS rci_crr_number     text,
  ADD COLUMN IF NOT EXISTS rci_verified       boolean NOT NULL DEFAULT false;
