-- Migration: Add professional_certifications table (Task #4)
-- Replaces the ad-hoc use of user_certifications for professional KYC documents.
-- Keyed by professional_id (not user_id) for clear direct linkage.

CREATE TABLE IF NOT EXISTS professional_certifications (
  id                SERIAL PRIMARY KEY,
  professional_id   INTEGER NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  document_type     TEXT NOT NULL,
  file_key          TEXT NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
