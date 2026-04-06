-- Migration: Add identity_verifications table for Task #4 (Identity Verification & Certification Uploads)
-- Creates enums and table; safe to re-run (uses IF NOT EXISTS / DO blocks)

DO $$ BEGIN
  CREATE TYPE id_document_type AS ENUM ('aadhar', 'passport', 'driving_licence', 'national_id');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE id_verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS identity_verifications (
  id                SERIAL PRIMARY KEY,
  professional_id   INTEGER NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  document_type     id_document_type NOT NULL,
  file_key          TEXT NOT NULL,
  status            id_verification_status NOT NULL DEFAULT 'pending',
  dpdp_consent      BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ
);
