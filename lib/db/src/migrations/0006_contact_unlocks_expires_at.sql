-- Add expires_at to contact_unlocks for teacher-scoped Plan A (30-day unlocks)
-- NULL means permanent unlock (Plan B per-contact); non-NULL means time-limited (Plan A 30-day)
ALTER TABLE contact_unlocks ADD COLUMN IF NOT EXISTS expires_at timestamptz;
