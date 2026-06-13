-- ============================================================================
-- Migration 0014 — Shadow-Teacher Matching Redesign (Chunk 1)
--
-- What this adds:
--   1. New status values on the shadow_match_status enum
--   2. New columns on shadow_teacher_matches (child snapshot, commit flow)
--   3. languages text[] column on professional_profiles
--   4. Three new tables: shadow_match_candidates, shadow_match_threads,
--      shadow_match_messages
--
-- All statements are idempotent (IF NOT EXISTS / DO-blocks) so it is safe to
-- re-run if partially applied.
-- ============================================================================

-- 1. Extend shadow_match_status enum
-- PostgreSQL requires each ADD VALUE to be a separate statement and does not
-- support IF NOT EXISTS before Postgres 14. The DO-block approach works on
-- all supported versions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'shadow_match_status'::regtype
      AND enumlabel = 'pending'
  ) THEN
    ALTER TYPE shadow_match_status ADD VALUE 'pending';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'shadow_match_status'::regtype
      AND enumlabel = 'shortlisted'
  ) THEN
    ALTER TYPE shadow_match_status ADD VALUE 'shortlisted';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'shadow_match_status'::regtype
      AND enumlabel = 'pending_commitment'
  ) THEN
    ALTER TYPE shadow_match_status ADD VALUE 'pending_commitment';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'shadow_match_status'::regtype
      AND enumlabel = 'committed'
  ) THEN
    ALTER TYPE shadow_match_status ADD VALUE 'committed';
  END IF;
END$$;

-- 2. New columns on shadow_teacher_matches

ALTER TABLE shadow_teacher_matches
  ADD COLUMN IF NOT EXISTS admin_notes            text,
  ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at            timestamptz,
  ADD COLUMN IF NOT EXISTS matched_professional_id integer
      REFERENCES professional_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selected_professional_id integer
      REFERENCES professional_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_id               integer
      REFERENCES children(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_city             text,
  ADD COLUMN IF NOT EXISTS child_conditions       text[],
  ADD COLUMN IF NOT EXISTS child_languages        text[],
  ADD COLUMN IF NOT EXISTS child_budget_min_inr   integer,
  ADD COLUMN IF NOT EXISTS child_budget_max_inr   integer,
  ADD COLUMN IF NOT EXISTS child_goals_areas      text[],
  ADD COLUMN IF NOT EXISTS child_preferred_modes  text[],
  ADD COLUMN IF NOT EXISTS extra_notes            text;

-- 3. languages column on professional_profiles

ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS languages text[];

-- 4a. shadow_match_candidates

CREATE TABLE IF NOT EXISTS shadow_match_candidates (
  id                  serial PRIMARY KEY,
  match_id            integer NOT NULL
      REFERENCES shadow_teacher_matches(id) ON DELETE CASCADE,
  professional_id     integer NOT NULL
      REFERENCES professional_profiles(id) ON DELETE CASCADE,
  score               real,
  rank                integer NOT NULL,
  added_by            text    NOT NULL DEFAULT 'auto',
  removed_at          timestamptz,
  removed_by_user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shadow_match_candidates_match_pro_unique
      UNIQUE (match_id, professional_id)
);

CREATE INDEX IF NOT EXISTS shadow_match_candidates_match_id_idx
  ON shadow_match_candidates (match_id);

-- 4b. shadow_match_threads

CREATE TABLE IF NOT EXISTS shadow_match_threads (
  id              serial PRIMARY KEY,
  match_id        integer NOT NULL
      REFERENCES shadow_teacher_matches(id) ON DELETE CASCADE,
  professional_id integer NOT NULL
      REFERENCES professional_profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shadow_match_threads_match_pro_unique
      UNIQUE (match_id, professional_id)
);

CREATE INDEX IF NOT EXISTS shadow_match_threads_match_id_idx
  ON shadow_match_threads (match_id);

-- 4c. shadow_match_messages

CREATE TABLE IF NOT EXISTS shadow_match_messages (
  id         serial PRIMARY KEY,
  thread_id  integer NOT NULL
      REFERENCES shadow_match_threads(id) ON DELETE CASCADE,
  sender_id  integer NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shadow_match_messages_thread_id_created_at_idx
  ON shadow_match_messages (thread_id, created_at);
