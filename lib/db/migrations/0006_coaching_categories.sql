-- Add 'coaching' to the specialty enum
ALTER TYPE specialty ADD VALUE IF NOT EXISTS 'coaching';

-- Create coaching sub-type enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coaching_sub_type') THEN
    EXECUTE '
      CREATE TYPE coaching_sub_type AS ENUM (
        ''swimming'', ''dance'', ''music'', ''sports'',
        ''singing'', ''fitness'', ''art'', ''yoga''
      )
    ';
  END IF;
END $$;

-- Add new columns to professional_profiles
ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS coaching_sub_type coaching_sub_type,
  ADD COLUMN IF NOT EXISTS inclusive_experience boolean NOT NULL DEFAULT false;
