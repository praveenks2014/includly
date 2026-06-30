-- 0032_professional_vertical.sql
-- Adds professional_vertical enum, vertical column (backfilled to
-- shadow_teacher for existing rows), certifications JSONB, and
-- idempotently re-applies the three columns from 0031 which did not
-- land in the live DB (drizzle-kit push stalled on an interactive prompt
-- during post-merge reconciliation).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'professional_vertical') THEN
    CREATE TYPE "professional_vertical" AS ENUM ('shadow_teacher', 'home_tutor', 'therapist');
  END IF;
END $$;

ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS vertical_details  jsonb,
  ADD COLUMN IF NOT EXISTS rci_crr_number    text,
  ADD COLUMN IF NOT EXISTS rci_verified      boolean NOT NULL DEFAULT false;

-- DEFAULT 'shadow_teacher' covers the backfill of all existing rows in one pass.
ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS vertical "professional_vertical" NOT NULL DEFAULT 'shadow_teacher';

-- Drop the default so future inserts must supply vertical explicitly.
ALTER TABLE professional_profiles
  ALTER COLUMN vertical DROP DEFAULT;

ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS certifications jsonb;
