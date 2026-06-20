-- 0024_intake_redesign.sql
-- Additive only. Two new columns on users for parent onboarding intent signals.
--   support_types : the service types a parent said they need at onboarding
--                   (multi-select; empty array for all pre-existing rows)
--   child_count   : how many children the parent declared at onboarding
--                   (soft-prompt reference only, never a hard cap; NULL for
--                    users who signed up before this column existed)

ALTER TABLE users ADD COLUMN IF NOT EXISTS support_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS child_count   integer;
